(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const API_URL = (cfg.API_URL || '').trim();
  const DEMO = !API_URL;
  const MAX_CONTENT = 5000;
  const KEY_STORAGE = 'iubabi.key';
  const DEVICE_STORAGE = 'iubabi.deviceId';
  const NAMES = { owner: cfg.OWNER_NAME || 'Anh', partner: cfg.PARTNER_NAME || 'Em' };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    lock: $('#lock'),
    lockForm: $('#lockForm'),
    lockError: $('#lockError'),
    btnUnlock: $('#btnUnlock'),
    app: $('#app'),
    grid: $('#grid'),
    status: $('#status'),
    heroStat: $('#heroStat'),
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

  const state = { key: '', role: '', letters: [], filter: 'all', query: '', openId: null };

  // ---------- Lưu trữ an toàn (localStorage có thể bị chặn) ----------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* bỏ qua */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* bỏ qua */ } },
  };

  // ---------- Mã thiết bị ----------
  // Trình duyệt không cho đọc mã máy thật, nên mỗi trình duyệt tự tạo một mã ngẫu nhiên và giữ lại.
  function getDeviceId() {
    let id = store.get(DEVICE_STORAGE);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      store.set(DEVICE_STORAGE, id);
    }
    return id;
  }
  const DEVICE_ID = getDeviceId();

  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Khác';
    const browser = /Zalo/i.test(ua) ? 'Zalo' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : 'Khác';
    return `${os} · ${browser}`;
  }

  // ---------- API ----------
  class LockedError extends Error {}

  // Chế độ thử: lưu thư trong localStorage để xem giao diện khi chưa có Apps Script.
  const demo = {
    KEY: 'iubabi.demoLetters',
    list() {
      const saved = JSON.parse(store.get(this.KEY) || 'null');
      if (saved) return saved;
      const seed = [{
        id: 'demo-1', type: 'owner', author: NAMES.owner, title: '',
        content: 'Thành phố Hồ Chí Minh, ngày 1 tháng 1 năm 2026\n\nĐây là lá thư mẫu ở chế độ thử.\n\nKhi nối với Google Sheets, những lá thư thật sẽ hiện ở đây.',
        createdAt: new Date().toISOString(),
      }];
      store.set(this.KEY, JSON.stringify(seed));
      return seed;
    },
    add(payload) {
      const letters = this.list();
      letters.unshift({
        id: 'demo-' + Date.now(),
        type: state.role,
        author: payload.author || NAMES[state.role],
        title: payload.title,
        content: payload.content,
        createdAt: new Date().toISOString(),
      });
      store.set(this.KEY, JSON.stringify(letters));
      return { ok: true };
    },
  };

  function checked(data) {
    if (data.locked) throw new LockedError(data.error || 'Mã bí mật không đúng.');
    if (!data.ok) throw new Error(data.error || 'Có lỗi xảy ra.');
    return data;
  }

  async function fetchLetters() {
    if (DEMO) return { ok: true, role: 'owner', letters: demo.list() };
    const res = await fetch(`${API_URL}?key=${encodeURIComponent(state.key)}`, { cache: 'no-store' });
    return checked(await res.json());
  }

  async function sendLetter(payload) {
    if (DEMO) return demo.add(payload);
    // Không đặt Content-Type để trình duyệt gửi text/plain → không bị preflight CORS với Apps Script.
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ ...payload, key: state.key }) });
    return checked(await res.json());
  }

  // ---------- Chuẩn bị dữ liệu ----------
  // Thư có thể mở đầu bằng dòng "Nơi chốn, ngày 21 tháng 6 năm 2025" — tách riêng để trình bày.
  const DATELINE = /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})\s*$/i;

  function parseContent(content) {
    const text = String(content || '').replace(/\r\n/g, '\n').trim();
    const firstBreak = text.indexOf('\n');
    const firstLine = (firstBreak < 0 ? text : text.slice(0, firstBreak)).trim();
    const m = firstLine.length <= 100 && firstLine.match(DATELINE);
    const body = m ? text.slice(firstLine.length).trim() : text;
    return {
      dateline: m ? firstLine : '',
      date: m ? new Date(+m[3], +m[2] - 1, +m[1]) : null,
      paragraphs: body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    };
  }

  function prepare(letters) {
    const list = letters.map((l) => {
      const parsed = parseContent(l.content);
      return { ...l, ...parsed, excerpt: parsed.paragraphs.join(' ').replace(/\s+/g, ' ') };
    });
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // Đánh số thư của mỗi người theo thứ tự gửi: lá thư số 1, số 2…
    ['owner', 'partner'].forEach((type) => {
      list.filter((l) => l.type === type).reverse().forEach((l, i) => { l.number = i + 1; });
    });
    return list;
  }

  // ---------- Hiển thị ----------
  const shortDate = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
  const letterDate = (l) => {
    const d = l.date || new Date(l.createdAt);
    return isNaN(d) ? null : d;
  };
  const titleOf = (l) => l.title || `Lá thư số ${l.number}`;
  const authorOf = (l) => l.author || NAMES[l.type];

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const seal = () => {
    const s = node('span', 'seal');
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.4 5c2 0 3.3 1 4.1 2.2h3C14.3 6 15.6 5 17.6 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"/></svg>';
    return s;
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
    const counts = { all: state.letters.length, owner: 0, partner: 0 };
    state.letters.forEach((l) => { counts[l.type] += 1; });
    document.querySelectorAll('[data-count]').forEach((n) => { n.textContent = counts[n.dataset.count] || ''; });
    el.heroStat.hidden = !counts.all;
    el.heroStat.textContent = `${counts.all} lá thư`;

    const list = visibleLetters();
    el.grid.replaceChildren(...list.map(card));
    el.status.hidden = list.length > 0;
    el.status.textContent = state.letters.length ? 'Không có lá thư nào khớp.' : 'Chưa có lá thư nào. Viết lá đầu tiên nhé.';
  }

  function card(letter, index) {
    const btn = node('button', 'card is-' + letter.type);
    btn.type = 'button';
    btn.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

    const d = letterDate(letter);
    btn.append(
      node('span', 'card-kicker', d ? shortDate.format(d) : ''),
      node('h3', 'card-title', titleOf(letter)),
      node('p', 'card-excerpt', letter.excerpt),
    );
    const foot = node('div', 'card-foot');
    foot.append(node('span', 'card-author', authorOf(letter)), seal());
    btn.append(foot);

    btn.addEventListener('click', () => { location.hash = 'thu/' + encodeURIComponent(letter.id); });
    return btn;
  }

  function skeletons(n) {
    return Array.from({ length: n }, () => {
      const c = node('div', 'card skeleton');
      c.setAttribute('aria-hidden', 'true');
      c.append(node('span'), node('span'), node('span'), node('span'));
      return c;
    });
  }

  function openLetter(id) {
    const letter = state.letters.find((l) => l.id === id);
    if (!letter) return;
    state.openId = id;

    const d = letterDate(letter);
    $('#readLetter').className = 'letter is-' + letter.type;
    $('#readDateline').textContent = letter.dateline || (d ? 'Ngày ' + shortDate.format(d) : '');
    $('#readTitle').textContent = titleOf(letter);
    $('#readBody').replaceChildren(...letter.paragraphs.map((p) => node('p', '', p)));
    $('#readAuthor').textContent = authorOf(letter);

    const list = visibleLetters();
    const pos = list.findIndex((l) => l.id === id);
    $('#readPos').textContent = pos >= 0 ? `${pos + 1} / ${list.length}` : '';
    el.readDialog.querySelector('[data-nav="-1"]').disabled = pos <= 0;
    el.readDialog.querySelector('[data-nav="1"]').disabled = pos < 0 || pos >= list.length - 1;

    if (!el.readDialog.open) el.readDialog.showModal();
    el.readDialog.scrollTop = 0;
  }

  function step(delta) {
    const list = visibleLetters();
    const next = list[list.findIndex((l) => l.id === state.openId) + delta];
    if (!next) return;
    history.replaceState(null, '', '#thu/' + encodeURIComponent(next.id));
    openLetter(next.id);
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

  // ---------- Khóa / mở khóa ----------
  function showApp(unlocked) {
    el.lock.hidden = unlocked;
    el.app.hidden = !unlocked;
  }

  function lock(message) {
    state.key = '';
    state.letters = [];
    store.remove(KEY_STORAGE);
    [el.readDialog, el.writeDialog].forEach((d) => d.open && d.close());
    el.grid.replaceChildren();
    el.lockForm.reset();
    el.lockError.textContent = message || '';
    el.lockError.hidden = !message;
    showApp(false);
    el.lockForm.key.focus();
  }

  function applyData(data) {
    state.role = data.role === 'partner' ? 'partner' : 'owner';
    state.letters = prepare(data.letters);
    render();
    routeFromHash();
  }

  async function load() {
    if (!state.letters.length) el.grid.replaceChildren(...skeletons(3));
    el.status.hidden = true;
    try {
      applyData(await fetchLetters());
    } catch (err) {
      if (err instanceof LockedError) {
        lock(err.message);
        return;
      }
      console.error(err);
      el.grid.replaceChildren();
      el.status.hidden = false;
      el.status.textContent = 'Không tải được thư. Vui lòng thử lại sau.';
    }
  }

  el.lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = el.lockForm.key.value.trim();
    if (!key) return;

    el.lockError.hidden = true;
    el.btnUnlock.disabled = true;
    el.btnUnlock.textContent = 'Đang mở…';
    state.key = key;
    try {
      const data = await fetchLetters();
      if (el.lockForm.remember.checked) store.set(KEY_STORAGE, key);
      showApp(true);
      applyData(data);
    } catch (err) {
      state.key = '';
      el.lockError.textContent = err instanceof LockedError ? err.message : 'Không kết nối được. Vui lòng thử lại.';
      el.lockError.hidden = false;
    } finally {
      el.btnUnlock.disabled = false;
      el.btnUnlock.textContent = 'Mở thư';
    }
  });

  $('#btnLock').addEventListener('click', () => lock());

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

  el.readDialog.querySelectorAll('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => step(Number(b.dataset.nav)));
  });
  el.readDialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
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

  document.querySelectorAll('[data-write]').forEach((b) => b.addEventListener('click', () => {
    el.formError.hidden = true;
    if (!el.writeForm.author.value) el.writeForm.author.value = NAMES[state.role];
    el.writeDialog.showModal();
  }));

  el.writeForm.content.addEventListener('input', () => {
    el.charCount.textContent = `${el.writeForm.content.value.length} / ${MAX_CONTENT}`;
  });

  el.writeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = el.writeForm;
    const payload = {
      author: f.author.value.trim(),
      title: f.title.value.trim(),
      content: f.content.value.trim(),
      deviceId: DEVICE_ID,
      device: deviceLabel(),
    };

    if (!payload.content) {
      el.formError.textContent = 'Chưa có nội dung thư.';
      el.formError.hidden = false;
      f.content.focus();
      return;
    }

    el.formError.hidden = true;
    el.btnSend.disabled = true;
    el.btnSend.textContent = 'Đang gửi…';
    try {
      await sendLetter(payload);
      f.reset();
      el.charCount.textContent = `0 / ${MAX_CONTENT}`;
      el.writeDialog.close();
      toast('Đã gửi thư 💌');
      await load();
    } catch (err) {
      if (err instanceof LockedError) {
        lock(err.message);
        return;
      }
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
    document.querySelectorAll('[data-site-title]').forEach((n) => { n.textContent = cfg.SITE_TITLE; });
    document.title = cfg.SITE_TITLE;
  }
  if (cfg.TAGLINE) $('#siteTagline').textContent = cfg.TAGLINE;
  $('#demoNotice').hidden = !DEMO;

  state.key = store.get(KEY_STORAGE) || '';
  if (state.key) {
    showApp(true);
    load();
  } else {
    lock();
  }
})();
