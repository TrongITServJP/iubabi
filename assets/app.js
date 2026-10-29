(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const API_URL = (cfg.API_URL || '').trim();
  const DEMO = !API_URL;
  const MAX_CONTENT = 5000;
  const KEY_STORAGE = 'iubabi.ownerKey';
  const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.4 5c2 0 3.3 1 4.1 2.2h3C14.3 6 15.6 5 17.6 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"/></svg>';

  const $ = (sel) => document.querySelector(sel);
  const el = {
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
      const seed = [{
        id: 'demo-1', type: 'owner', author: cfg.OWNER_NAME || 'Chủ trang', title: '',
        content: 'Thành phố Hồ Chí Minh, ngày 1 tháng 1 năm 2026\n\nĐây là lá thư mẫu ở chế độ thử.\n\nKhi nối với Google Sheets, những lá thư thật sẽ hiện ở đây.',
        createdAt: new Date().toISOString(),
      }];
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
    // Đánh số thư của chủ trang theo thứ tự gửi: lá thư số 1, số 2…
    list.filter((l) => l.type === 'owner').reverse().forEach((l, i) => { l.number = i + 1; });
    return list;
  }

  // ---------- Hiển thị ----------
  const shortDate = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
  const letterDate = (l) => {
    const d = l.date || new Date(l.createdAt);
    return isNaN(d) ? null : d;
  };
  const titleOf = (l) => l.title || (l.number ? `Lá thư số ${l.number}` : 'Một lá thư');

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const seal = () => {
    const s = node('span', 'seal');
    s.innerHTML = HEART_SVG;
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
    const counts = { all: state.letters.length, owner: 0, guest: 0 };
    state.letters.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });
    document.querySelectorAll('[data-count]').forEach((n) => { n.textContent = counts[n.dataset.count] || ''; });
    el.heroStat.hidden = !counts.all;
    el.heroStat.textContent = `${counts.all} lá thư đã được gửi`;

    const list = visibleLetters();
    el.grid.replaceChildren(...list.map(card));
    el.status.hidden = list.length > 0;
    el.status.textContent = state.letters.length
      ? 'Không có lá thư nào khớp.'
      : 'Chưa có lá thư nào. Hãy là người viết đầu tiên.';
  }

  function card(letter, index) {
    const owner = letter.type === 'owner';
    const btn = node('button', 'card' + (owner ? ' is-owner' : ''));
    btn.type = 'button';
    btn.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

    const d = letterDate(letter);
    btn.append(
      node('span', 'card-kicker', d ? shortDate.format(d) : ''),
      node('h3', 'card-title', titleOf(letter)),
      node('p', 'card-excerpt', letter.excerpt),
    );
    const foot = node('div', 'card-foot');
    foot.append(node('span', 'card-author', letter.author || 'Ẩn danh'));
    if (owner) foot.append(seal());
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
    $('#readLetter').classList.toggle('is-owner', letter.type === 'owner');
    $('#readDateline').textContent = letter.dateline || (d ? 'Ngày ' + shortDate.format(d) : '');
    $('#readTitle').textContent = titleOf(letter);
    $('#readBody').replaceChildren(...letter.paragraphs.map((p) => node('p', '', p)));
    $('#readAuthor').textContent = letter.author || 'Ẩn danh';

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

  async function load() {
    if (!state.letters.length) el.grid.replaceChildren(...skeletons(3));
    el.status.hidden = true;
    try {
      state.letters = prepare(await fetchLetters());
      render();
      routeFromHash();
    } catch (err) {
      console.error(err);
      el.grid.replaceChildren();
      el.status.hidden = false;
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
    const savedKey = store.get(KEY_STORAGE);
    if (savedKey) {
      el.writeForm.ownerKey.value = savedKey;
      el.writeForm.rememberKey.checked = true;
      el.writeForm.querySelector('.owner-box').open = true;
    }
    el.writeDialog.showModal();
  }));

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
