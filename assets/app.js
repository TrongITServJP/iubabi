(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const API_URL = (cfg.API_URL || '').trim();
  const DEMO = !API_URL;
  const MAX_CONTENT = 5000;
  const KEY_STORAGE = 'iubabi.ownerKey';

  const $ = (sel) => document.querySelector(sel);
  const el = {
    grid: $('#grid'),
    status: $('#status'),
    search: $('#search'),
    tabs: document.querySelectorAll('.tabs [data-filter]'),
    readDialog: $('#readDialog'),
    writeDialog: $('#writeDialog'),
    writeForm: $('#writeForm'),
    formError: $('#formError'),
    btnSend: $('#btnSend'),
    charCount: $('#charCount'),
    toast: $('#toast'),
  };

  const state = { letters: [], filter: 'all', query: '', openId: null };

  // ---------- Lưu trữ an toàn (localStorage có thể bị chặn) ----------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* bỏ qua */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* bỏ qua */ } },
  };

  // ---------- API ----------
  // Chế độ thử: lưu thư trong localStorage để xem giao diện khi chưa có Apps Script.
  const demo = {
    KEY: 'iubabi.demoLetters',
    list() {
      const saved = JSON.parse(store.get(this.KEY) || 'null');
      if (saved) return saved;
      const seed = [
        {
          id: 'demo-1', type: 'owner', author: cfg.OWNER_NAME || 'Chủ trang',
          title: 'Lá thư đầu tiên',
          content: 'Chào bạn,\n\nĐây là lá thư mẫu ở chế độ thử. Khi nối với Google Sheets, những lá thư thật sẽ hiện ở đây.\n\nThân mến.',
          createdAt: new Date().toISOString(),
        },
      ];
      store.set(this.KEY, JSON.stringify(seed));
      return seed;
    },
    add(payload) {
      const letters = this.list();
      const letter = {
        id: 'demo-' + Date.now(),
        type: payload.ownerKey ? 'owner' : 'guest',
        author: payload.author || 'Ẩn danh',
        title: payload.title,
        content: payload.content,
        createdAt: new Date().toISOString(),
      };
      letters.unshift(letter);
      store.set(this.KEY, JSON.stringify(letters));
      return { ok: true, id: letter.id, status: 'show' };
    },
  };

  async function fetchLetters() {
    if (DEMO) return demo.list();
    const res = await fetch(API_URL, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Không tải được thư.');
    return data.letters;
  }

  async function sendLetter(payload) {
    if (DEMO) return demo.add(payload);
    // Không đặt Content-Type để trình duyệt gửi text/plain → không bị preflight CORS với Apps Script.
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Không gửi được thư.');
    return data;
  }

  // ---------- Hiển thị ----------
  const dateFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const longDateFmt = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const formatDate = (iso, fmt = dateFmt) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : fmt.format(d);
  };

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  function visibleLetters() {
    const q = state.query.toLowerCase();
    return state.letters.filter((l) => {
      if (state.filter !== 'all' && l.type !== state.filter) return false;
      if (!q) return true;
      return [l.title, l.author, l.content].some((s) => (s || '').toLowerCase().includes(q));
    });
  }

  function render() {
    const counts = { all: state.letters.length, owner: 0, guest: 0 };
    state.letters.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });
    document.querySelectorAll('[data-count]').forEach((n) => { n.textContent = counts[n.dataset.count] || 0; });

    const list = visibleLetters();
    el.grid.replaceChildren(...list.map(card));
    if (list.length) {
      el.status.hidden = true;
    } else {
      el.status.hidden = false;
      el.status.textContent = state.letters.length
        ? 'Không có lá thư nào khớp.'
        : 'Chưa có lá thư nào. Hãy là người viết đầu tiên.';
    }
  }

  function card(letter) {
    const btn = node('button', 'card' + (letter.type === 'owner' ? ' is-owner' : ''));
    btn.type = 'button';
    if (letter.type === 'owner') btn.append(node('span', 'badge', 'Thư của tôi'));
    btn.append(
      node('h3', 'card-title', letter.title || 'Không tiêu đề'),
      node('p', 'card-excerpt', letter.content),
    );
    const meta = node('div', 'card-meta');
    meta.append(node('span', '', letter.author || 'Ẩn danh'), node('span', '', formatDate(letter.createdAt)));
    btn.append(meta);
    btn.addEventListener('click', () => { location.hash = 'thu/' + encodeURIComponent(letter.id); });
    return btn;
  }

  function openLetter(id) {
    const letter = state.letters.find((l) => l.id === id);
    if (!letter) return;
    state.openId = id;
    $('#readBadge').textContent = letter.type === 'owner' ? 'Thư của tôi' : '';
    $('#readTitle').textContent = letter.title || 'Không tiêu đề';
    $('#readDate').textContent = formatDate(letter.createdAt, longDateFmt);
    $('#readBody').textContent = letter.content;
    $('#readAuthor').textContent = '— ' + (letter.author || 'Ẩn danh');
    if (!el.readDialog.open) el.readDialog.showModal();
    el.readDialog.scrollTop = 0;
  }

  function routeFromHash() {
    const m = location.hash.match(/^#thu\/(.+)$/);
    if (m) openLetter(decodeURIComponent(m[1]));
    else if (el.readDialog.open) el.readDialog.close();
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  async function load() {
    el.status.hidden = false;
    el.status.textContent = 'Đang tải thư…';
    try {
      const letters = await fetchLetters();
      state.letters = letters.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      render();
      routeFromHash();
    } catch (err) {
      console.error(err);
      el.grid.replaceChildren();
      el.status.textContent = 'Không tải được thư. Vui lòng thử lại sau.';
    }
  }

  // ---------- Sự kiện ----------
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      el.tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      render();
    });
  });

  el.search.addEventListener('input', () => {
    state.query = el.search.value.trim();
    render();
  });

  // Đóng dialog: nút [data-close] hoặc bấm ra ngoài khung
  [el.readDialog, el.writeDialog].forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  });

  el.readDialog.addEventListener('close', () => {
    state.openId = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  });

  $('#btnCopyLink').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#thu/' + encodeURIComponent(state.openId);
    try {
      await navigator.clipboard.writeText(url);
      toast('Đã sao chép liên kết.');
    } catch {
      toast(url);
    }
  });

  $('#btnWrite').addEventListener('click', () => {
    el.formError.hidden = true;
    const savedKey = store.get(KEY_STORAGE);
    if (savedKey) {
      el.writeForm.ownerKey.value = savedKey;
      el.writeForm.rememberKey.checked = true;
      el.writeForm.querySelector('.owner-box').open = true;
    }
    el.writeDialog.showModal();
    el.writeForm.author.focus();
  });

  el.writeForm.content.addEventListener('input', () => {
    el.charCount.textContent = `${el.writeForm.content.value.length} / ${MAX_CONTENT}`;
  });

  el.writeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = el.writeForm;
    const ownerKey = f.ownerKey.value.trim();
    const payload = {
      author: f.author.value.trim() || (ownerKey ? cfg.OWNER_NAME || '' : ''),
      title: f.title.value.trim(),
      content: f.content.value.trim(),
      website: f.website.value, // bẫy bot
      ownerKey,
    };

    if (!payload.content) {
      el.formError.textContent = 'Bạn chưa viết nội dung thư.';
      el.formError.hidden = false;
      f.content.focus();
      return;
    }

    el.formError.hidden = true;
    el.btnSend.disabled = true;
    el.btnSend.textContent = 'Đang gửi…';
    try {
      const result = await sendLetter(payload);
      if (ownerKey && f.rememberKey.checked) store.set(KEY_STORAGE, ownerKey);
      else store.remove(KEY_STORAGE);
      f.reset();
      el.charCount.textContent = `0 / ${MAX_CONTENT}`;
      el.writeDialog.close();
      toast(result.status === 'pending'
        ? 'Đã gửi thư. Thư sẽ hiện sau khi được duyệt.'
        : 'Đã gửi thư. Cảm ơn bạn!');
      await load();
    } catch (err) {
      el.formError.textContent = err.message || 'Không gửi được thư. Vui lòng thử lại.';
      el.formError.hidden = false;
    } finally {
      el.btnSend.disabled = false;
      el.btnSend.textContent = 'Gửi thư';
    }
  });

  window.addEventListener('hashchange', routeFromHash);

  // ---------- Khởi động ----------
  if (cfg.SITE_TITLE) {
    $('#siteTitle').textContent = cfg.SITE_TITLE;
    document.title = `${cfg.SITE_TITLE} · Những lá thư`;
  }
  if (cfg.TAGLINE) $('#siteTagline').textContent = cfg.TAGLINE;
  $('#demoNotice').hidden = !DEMO;

  load();
})();
