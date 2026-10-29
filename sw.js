// Service worker: cho phép cài như app, mở được khi mạng yếu, và nhận thông báo thư mới.
const CACHE = 'iubabi-v1';
const SHELL = ['./', 'index.html', 'config.js', 'assets/style.css', 'assets/app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Ưu tiên mạng để luôn có bản mới; mất mạng thì dùng bản đã lưu. Không đụng tới API (khác tên miền).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
  );
});

// Thông báo đẩy không kèm nội dung (thư chỉ đọc được khi có mã bí mật).
self.addEventListener('push', (event) => {
  event.waitUntil(Promise.all([
    self.registration.showNotification('Có thư mới 💌', {
      body: 'Mở iubabi để đọc nhé.',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'new-letter',
      renotify: true,
    }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
