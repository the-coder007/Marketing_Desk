/* YMC Diwali voucher portal.
   Plain JavaScript: no libraries and no network calls.
   Needs vault.js (unlock) and vault-data.js (YMC_VAULT) to be loaded first. */
(function () {
  'use strict';

  /*FRAME_GUARD_START*/
  // Do not run inside another page. This is clickjacking protection that works without server headers.
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    return;
  }
  /*FRAME_GUARD_END*/

  /* ---------- settings ---------- */
  const IDLE_MS = 2 * 60 * 1000;    // sign out after 2 minutes without activity
  const HIDDEN_MS = 45 * 1000;      // sign out after 45 seconds in a background tab
  const REVEAL_MS = 20 * 1000;      // a revealed code hides again after 20 seconds
  const FREE_TRIES = 5;             // wrong attempts before the first lockout
  const GUARD_KEY = 'ymc-voucher-guard';
  const IDLE_MSG = 'You were signed out after 2 minutes of inactivity.';
  const BG_MSG = 'You were signed out because the page was in the background.';
  const PAN_RE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
  const FONTS_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Mukta:wght@400;500;600;700&family=Yatra+One&display=swap';

  /* ---------- small helpers ---------- */
  const fmtNum = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
  const fmtDate = (iso) =>
    new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  const isExpired = (iso) => new Date(iso + 'T23:59:59+05:30').getTime() < Date.now();
  const maskCode = (c) => '•'.repeat(Math.max(c.length - 4, 0)) + c.slice(-4);
  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
  const lockLabel = (s) => {
    if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
    const m = Math.ceil(s / 60);
    return m + (m === 1 ? ' minute' : ' minutes');
  };

  /* Builds an element. attrs: class, text, vars (CSS custom properties), anything else is an attribute. */
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'vars') { for (const p in v) n.style.setProperty(p, String(v[p])); }
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids || []) {
      if (c === undefined || c === null || c === false) continue;
      n.append(c);
    }
    return n;
  }

  /* Turns a trusted, fixed SVG string from this file into an element. Never used with employee data. */
  function svgFrom(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup;
    return t.content.firstElementChild;
  }

  /* ---------- icons and artwork ---------- */
  const SV = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const ICONS = {
    copy: '<svg ' + SV + '><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    check: '<svg ' + SV + '><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    alert: '<svg ' + SV + '><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
    lock: '<svg ' + SV + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };
  const icon = (name) => svgFrom(ICONS[name]);

  const DEFS =
    '<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
    '<radialGradient id="glow"><stop offset="0" stop-color="#FFC24A" stop-opacity="0.8"/><stop offset="0.5" stop-color="#F28A2E" stop-opacity="0.26"/><stop offset="1" stop-color="#F28A2E" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="flameG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#F28A2E"/><stop offset="0.6" stop-color="#FFC24A"/><stop offset="1" stop-color="#FFF1B8"/></linearGradient>' +
    '<linearGradient id="clay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C4572B"/><stop offset="1" stop-color="#6E1B2B"/></linearGradient>' +
    '</defs></svg>';

  function mandala(cls) {
    let parts = '';
    for (let i = 0; i < 24; i++) parts += '<path d="M0,-282 C16,-258 16,-228 0,-204 C-16,-228 -16,-258 0,-282Z" transform="rotate(' + i * 15 + ')"/>';
    for (let i = 0; i < 16; i++) parts += '<path d="M0,-196 C34,-170 34,-120 0,-88 C-34,-120 -34,-170 0,-196Z" transform="rotate(' + i * 22.5 + ')"/>';
    for (let i = 0; i < 8; i++) parts += '<path d="M0,-84 C22,-64 22,-38 0,-18 C-22,-38 -22,-64 0,-84Z" transform="rotate(' + i * 45 + ')"/>';
    let dots = '';
    for (let i = 0; i < 48; i++) {
      const a = (i * 7.5 * Math.PI) / 180;
      dots += '<circle cx="' + (296 * Math.sin(a)).toFixed(1) + '" cy="' + (-296 * Math.cos(a)).toFixed(1) + '" r="' + (i % 2 ? 1.4 : 2.3) + '"/>';
    }
    return svgFrom(
      '<svg class="mandala ' + cls + '" viewBox="-300 -300 600 600" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.2"><circle r="292"/><circle r="200"/><circle r="92"/><circle r="14"/>' + parts + '</g>' +
      '<g fill="currentColor" stroke="none">' + dots + '</g></svg>');
  }

  function diya(size, delay) {
    const n = svgFrom(
      '<svg class="diya" width="' + size + '" height="' + Math.round(size * 0.95) + '" viewBox="0 0 120 114" aria-hidden="true" focusable="false">' +
      '<ellipse class="diya-glow" cx="60" cy="32" rx="52" ry="46" fill="url(#glow)"/>' +
      '<g class="flame"><path d="M60 6 C72 22 76 34 70 44 C66 50 54 50 50 44 C44 34 48 22 60 6Z" fill="url(#flameG)"/>' +
      '<path d="M60 24 C64 31 65 37 62 42 C60 44.5 58 44.5 57 42 C55 37 56 31 60 24Z" fill="#FFF6D8"/></g>' +
      '<rect x="58" y="42" width="4" height="10" rx="2" fill="#3A1A14"/>' +
      '<path d="M8 54 C8 84 34 104 60 104 C86 104 112 84 112 54Z" fill="url(#clay)"/>' +
      '<ellipse cx="60" cy="54" rx="52" ry="9" fill="#3B0F1C" stroke="#F0C25A" stroke-width="2"/>' +
      '<path d="M24 74 C38 88 82 88 96 74" fill="none" stroke="#F0C25A" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/></svg>');
    n.style.setProperty('--d', delay + 's');
    return n;
  }
  const DIYAS = [[62, 0], [84, 0.7], [104, 1.3], [84, 0.35], [62, 1]];

  /* Slow drifting embers on a canvas. Skipped when the person prefers reduced motion. */
  function embers() {
    const cv = el('canvas', { class: 'embers' });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return cv;
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, ht = 0;
    const resize = () => {
      w = window.innerWidth; ht = window.innerHeight;
      cv.width = w * dpr; cv.height = ht * dpr;
      cv.style.width = w + 'px'; cv.style.height = ht + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const spawn = (init) => ({ x: Math.random() * w, y: init ? Math.random() * ht : ht + 10, r: 0.7 + Math.random() * 1.7, vy: 0.15 + Math.random() * 0.4, ph: Math.random() * 6.28, hue: Math.random() < 0.6 ? 44 : 28 });
    const ps = Array.from({ length: w < 600 ? 20 : 38 }, () => spawn(true));
    const tick = () => {
      ctx.clearRect(0, 0, w, ht);
      for (const p of ps) {
        p.ph += 0.025;
        p.y -= p.vy;
        p.x += Math.sin(p.ph) * 0.25;
        if (p.y < -10) Object.assign(p, spawn(false));
        const a = 0.3 + 0.3 * Math.sin(p.ph * 2);
        ctx.fillStyle = 'hsla(' + p.hue + ',95%,62%,' + (a * 0.22).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.2, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'hsla(' + p.hue + ',100%,72%,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return cv;
  }

  function logo(large) {
    const ht = large ? 40 : 30;
    return el('span', { class: 'logo-plate' + (large ? ' lg' : '') }, [
      el('img', { src: 'assets/logo.png', alt: 'YMC India', width: Math.round(ht * 446 / 154), height: ht }),
    ]);
  }

  function money(value) {
    return el('span', { class: 'money' }, [
      el('span', { class: 'rs', 'aria-hidden': 'true', text: '₹' }),
      el('span', { class: 'amt', text: fmtNum(value) }),
      el('span', { class: 'sr', text: ' rupees' }),
    ]);
  }

  /* Faint diagonal text with the signed-in employee code across the page. It shows up in any
     screenshot, so a shared screenshot can be traced back to the person who took it. */
  function watermark(text) {
    const label = text + '  ·  YMC India';
    const w = Math.round(label.length * 8.6 + 80);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="190">' +
      '<text x="24" y="110" transform="rotate(-22 ' + w / 2 + ' 95)" font-family="Arial, sans-serif" font-size="14" fill="#ffffff" fill-opacity="0.07">' + xmlEsc(label) + '</text></svg>';
    const n = el('div', { class: 'watermark', 'aria-hidden': 'true' });
    n.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    return n;
  }

  /* ---------- failed-attempt counter ----------
     Kept in this browser so it survives a reload. It slows down casual guessing. The real protection
     is the encryption, because a determined person can clear this counter. */
  function readGuard() {
    try {
      const g = JSON.parse(localStorage.getItem(GUARD_KEY) || '{}');
      const n = Number(g.n) || 0, until = Number(g.until) || 0, at = Number(g.at) || 0;
      if (n && Date.now() - at > 30 * 60 * 1000) return { n: 0, until: 0, at: 0 };
      return { n: n, until: until, at: at };
    } catch (_) { return { n: 0, until: 0, at: 0 }; }
  }
  function writeGuard(g) {
    try { localStorage.setItem(GUARD_KEY, JSON.stringify(g)); } catch (_) { /* storage unavailable */ }
  }

  /* ---------- app state ---------- */
  const root = document.getElementById('root');
  let user = null;            // the signed-in employee record, held in memory only
  let leaveView = null;       // clean-up for the view on screen
  let stopSession = null;     // removes the inactivity listeners

  function mount(view, cleanup) {
    if (leaveView) leaveView();
    leaveView = cleanup || null;
    root.replaceChildren(view);
    window.scrollTo(0, 0);
  }

  /* ---------- login view ---------- */
  function showLogin(notice) {
    if (stopSession) { stopSession(); stopSession = null; }
    user = null;

    let guard = readGuard();
    let lockUntil = guard.until > Date.now() ? guard.until : 0;
    let lockTimer = 0;
    let busy = false;

    const codeIn = el('input', { id: 'empcode', name: 'ymc-code', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'YMC0000' });
    const pwIn = el('input', { id: 'password', name: 'ymc-pass', type: 'password', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCDE1234F' });
    const toggle = el('button', { type: 'button', class: 'pw-toggle', 'aria-pressed': 'false', text: 'Show' });
    const errText = el('span');
    const errBox = el('div', { class: 'msg err', role: 'alert', hidden: true }, [icon('alert'), errText]);
    const btn = el('button', { type: 'submit', class: 'btn', text: 'View my vouchers' });

    const setError = (msg) => { errText.textContent = msg; errBox.hidden = !msg; };
    const setBusy = (on) => {
      busy = on;
      btn.disabled = on || lockUntil > Date.now();
      btn.replaceChildren(...(on ? [el('span', { class: 'spin' }), ' Unlocking…'] : ['View my vouchers']));
    };

    toggle.addEventListener('click', () => {
      const show = pwIn.type === 'password';
      pwIn.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(show));
    });

    function tick() {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        lockUntil = 0;
        clearInterval(lockTimer); lockTimer = 0;
        setError('');
        btn.disabled = busy;
        return;
      }
      setError('Too many attempts. Try again in ' + lockLabel(left) + '.');
      btn.disabled = true;
    }
    function startLock(until) {
      lockUntil = until;
      clearInterval(lockTimer);
      tick();
      if (lockUntil) lockTimer = setInterval(tick, 500);
    }

    const form = el('form', { novalidate: true, autocomplete: 'off' }, [
      notice ? el('div', { class: 'msg info', role: 'status' }, [icon('lock'), el('span', { text: notice })]) : null,
      el('div', { class: 'field' }, [el('label', { for: 'empcode', text: 'Employee Code' }), codeIn]),
      el('div', { class: 'field' }, [
        el('label', { for: 'password', text: 'Password (your PAN)' }),
        el('div', { class: 'pw' }, [pwIn, toggle]),
      ]),
      errBox,
      btn,
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy || lockUntil > Date.now()) return;
      const code = codeIn.value, pw = pwIn.value;
      if (typeof YMC_VAULT === 'undefined' || typeof unlock !== 'function') { setError('The portal data did not load. Reload the page and try again.'); return; }
      if (!/^[A-Za-z0-9]{3,20}$/.test(code.replace(/\s+/g, ''))) { setError('Enter your employee code, for example YMC0000.'); return; }
      if (!PAN_RE.test(pw.replace(/[\s-]+/g, ''))) { setError('Enter your 10-character PAN as the password, for example ABCDE1234F.'); return; }
      if (!(window.crypto && window.crypto.subtle)) { setError('This browser cannot run the secure unlock. Open the page in Chrome, Edge, Safari or Firefox over https.'); return; }
      setError(''); setBusy(true);
      let record = null;
      try {
        record = await unlock(YMC_VAULT, code, pw);
      } catch (_) {
        const n = guard.n + 1;
        const until = n >= FREE_TRIES ? Date.now() + Math.min(900, 30 * Math.pow(2, n - FREE_TRIES)) * 1000 : 0;
        guard = { n: n, until: until, at: Date.now() };
        writeGuard(guard);
        pwIn.value = '';
        setBusy(false);
        if (until) {
          startLock(until);
        } else {
          const left = FREE_TRIES - n;
          setError('Employee code or PAN is incorrect. Check both and try again. ' + left + (left === 1 ? ' attempt' : ' attempts') + ' left before a lockout.');
        }
        return;
      }
      guard = { n: 0, until: 0, at: 0 };
      writeGuard(guard);
      pwIn.value = ''; codeIn.value = '';
      showDashboard(record);
    });

    const view = el('main', { class: 'login' }, [
      el('section', { class: 'brand rise' }, [
        logo(true),
        el('p', { class: 'eyebrow', text: 'YMC India · Employee Portal' }),
        el('h1', { class: 'deva', lang: 'hi', text: 'शुभ दीपावली' }),
        el('p', { class: 'lead', text: 'Happy Diwali from the YMC India team.' }),
        el('p', { class: 'sub', text: 'Sign in with your employee code to see the Amazon vouchers set aside for you.' }),
        el('p', { class: 'trust' }, [icon('lock'), el('span', { text: 'Your vouchers are encrypted. They open only with your own employee code and PAN.' })]),
      ]),
      el('section', { class: 'card glass rise', vars: { '--i': 1 }, 'aria-labelledby': 'signin-h' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { id: 'signin-h', text: 'Sign in' }),
          el('p', { text: 'Use your employee code, and your PAN as the password.' }),
        ]),
        form,
      ]),
      el('div', { class: 'diyas rise', vars: { '--i': 2 }, 'aria-hidden': 'true' }, DIYAS.map((d) => diya(d[0], d[1]))),
    ]);

    mount(view, () => { clearInterval(lockTimer); });
    if (lockUntil) startLock(lockUntil);
  }

  /* ---------- dashboard view ---------- */
  function voucherCard(v, index, count, flash, track) {
    let shown = false, hideT = 0, copyT = 0;
    const codeEl = el('p', { class: 'code masked', text: maskCode(v.code) });
    const revealBtn = el('button', { type: 'button', class: 'ghost', 'aria-pressed': 'false', text: 'Reveal' });
    const copyBtn = el('button', { type: 'button', class: 'copy-btn', 'aria-label': 'Copy gift card code ' + (index + 1) });

    const paintCopy = (state) => {
      copyBtn.className = 'copy-btn' + (state === 'copied' ? ' ok' : '');
      copyBtn.replaceChildren(icon(state === 'copied' ? 'check' : 'copy'), state === 'copied' ? 'Copied' : state === 'manual' ? 'Revealed' : 'Copy Code');
    };
    paintCopy('idle');

    const setShown = (on) => {
      clearTimeout(hideT);
      shown = on;
      codeEl.textContent = on ? v.code : maskCode(v.code);
      codeEl.classList.toggle('masked', !on);
      revealBtn.textContent = on ? 'Hide' : 'Reveal';
      revealBtn.setAttribute('aria-pressed', String(on));
      if (on) hideT = setTimeout(() => setShown(false), REVEAL_MS);
    };
    revealBtn.addEventListener('click', () => setShown(!shown));

    copyBtn.addEventListener('click', async () => {
      let how = 'manual';
      try {
        await navigator.clipboard.writeText(v.code);
        how = 'copied';
      } catch (_) {
        try {
          const ta = el('textarea', { readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
          ta.value = v.code;
          ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          if (document.execCommand('copy')) how = 'copied';
          document.body.removeChild(ta);
        } catch (__) { /* falls through to manual copy */ }
      }
      if (how === 'manual') setShown(true);
      paintCopy(how);
      flash(how === 'copied' ? 'Code copied to clipboard' : 'Code revealed. Select it and copy it manually.');
      clearTimeout(copyT);
      copyT = setTimeout(() => paintCopy('idle'), 2400);
    });

    track(() => { clearTimeout(hideT); clearTimeout(copyT); });

    const expired = v.validity ? isExpired(v.validity) : false;
    return el('article', { class: 'vcard glass rise', vars: { '--i': index + 2 } }, [
      el('header', { class: 'vc-head' }, [
        el('div', {}, [
          el('p', { class: 'vc-kind', text: 'Amazon.in Gift Card' }),
          el('p', { class: 'vc-idx', text: 'Voucher ' + (index + 1) + ' of ' + count }),
        ]),
        el('div', { class: 'vc-amt' }, [money(v.amount)]),
      ]),
      el('div', { class: 'perf', 'aria-hidden': 'true' }),
      el('div', { class: 'vc-body' }, [el('p', { class: 'vc-label', text: 'Gift card code' }), codeEl]),
      el('footer', { class: 'vc-foot' }, [
        v.validity ? el('span', { class: 'valid' + (expired ? ' expired' : ''), text: (expired ? 'Expired on ' : 'Valid till ') + fmtDate(v.validity) }) : null,
        el('div', { class: 'vc-actions' }, [revealBtn, copyBtn]),
      ]),
    ]);
  }

  function showDashboard(record) {
    user = record;
    const list = record.vouchers;
    const total = list.reduce((s, v) => s + v.amount, 0);
    const earliest = list.map((v) => v.validity).filter(Boolean).sort()[0];
    const groups = {};
    list.forEach((v) => { groups[v.amount] = (groups[v.amount] || 0) + 1; });
    const denoms = Object.keys(groups).map(Number).sort((a, b) => b - a);

    const cleanups = [];
    const track = (fn) => cleanups.push(fn);

    const toast = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    let toastT = 0;
    const flash = (msg) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastT);
      toastT = setTimeout(() => toast.classList.remove('show'), 2400);
    };
    track(() => clearTimeout(toastT));

    const logoutBtn = el('button', { type: 'button', class: 'ghost', text: 'Log out' });
    logoutBtn.addEventListener('click', () => showLogin(''));

    const view = el('div', { class: 'dash' }, [
      watermark(record.empCode),
      el('header', { class: 'topbar' }, [
        logo(false),
        el('div', { class: 'topbar-r' }, [el('span', { class: 'who', text: record.empCode }), logoutBtn]),
      ]),

      el('section', { class: 'hello rise' }, [
        el('p', { class: 'deva-sm', lang: 'hi', text: 'शुभ दीपावली' }),
        el('h1', { text: 'Happy Diwali, ' + record.name + '!' }),
        el('p', { class: 'sub', text: 'Thank you for everything you do at YMC India. Your Amazon vouchers are below.' }),
      ]),

      el('div', { class: 'board' }, [
        el('section', { class: 'col-total', 'aria-labelledby': 't-h' }, [
          el('h2', { id: 't-h', class: 'sec-h', text: 'Total voucher value' }),
          el('div', { class: 'total glass rise', vars: { '--i': 1 } }, [
            mandala('total-m'),
            el('p', { class: 'big' }, [money(total)]),
            el('p', { class: 'sub', text: list.length + (list.length === 1 ? ' voucher' : ' vouchers') + (earliest ? ' · Earliest expiry ' + fmtDate(earliest) : '') }),
            el('ul', { class: 'chips', 'aria-label': 'Voucher breakdown' }, denoms.map((a) => el('li', { class: 'chip', text: '₹' + fmtNum(a) + ' × ' + groups[a] }))),
          ]),
        ]),
        el('section', { class: 'col-vouchers', 'aria-labelledby': 'v-h' }, [
          el('h2', { id: 'v-h', class: 'sec-h', text: 'Your vouchers' }),
          el('div', { class: 'vgrid', 'data-multi': String(list.length > 1) }, list.map((v, i) => voucherCard(v, i, list.length, flash, track))),
        ]),
      ]),

      el('section', { class: 'help', 'aria-labelledby': 'r-h' }, [
        el('h2', { id: 'r-h', class: 'sec-h sm', text: 'How to redeem' }),
        el('ol', { class: 'steps' }, [
          el('li', { text: 'Tap Copy Code on the voucher you want to use.' }),
          el('li', { text: 'Sign in to Amazon.in and open Gift Cards.' }),
          el('li', { text: 'Choose Redeem a Gift Card, paste the code and confirm.' }),
        ]),
        el('p', { class: 'note' }, [icon('lock'), el('span', { text: 'Keep your codes private. Anyone who has a code can redeem it.' })]),
        el('p', { class: 'note-sub', text: 'Codes stay hidden until you tap Reveal and hide again after 20 seconds.' }),
      ]),

      el('footer', { class: 'foot' }, [
        el('span', { text: 'YMC India · Internal employee portal' }),
        el('span', { text: 'You are signed out after 2 minutes without activity, or 45 seconds in the background.' }),
      ]),
      toast,
    ]);

    mount(view, () => { cleanups.forEach((fn) => fn()); });
    startSession();
  }

  /* ---------- automatic sign-out ---------- */
  function startSession() {
    if (stopSession) stopSession();
    let last = Date.now(), hiddenAt = 0, idleT = 0, hiddenT = 0;
    const out = (msg) => showLogin(msg);

    const reset = () => {
      last = Date.now();
      clearTimeout(idleT);
      idleT = setTimeout(() => out(IDLE_MSG), IDLE_MS);
    };
    // Background tabs throttle timers, so also compare timestamps when the tab comes back.
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        clearTimeout(hiddenT);
        hiddenT = setTimeout(() => out(BG_MSG), HIDDEN_MS);
        return;
      }
      clearTimeout(hiddenT);
      const n = Date.now();
      if (hiddenAt && n - hiddenAt > HIDDEN_MS) { out(BG_MSG); return; }
      if (n - last > IDLE_MS) { out(IDLE_MSG); return; }
      hiddenAt = 0;
    };

    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    reset();

    stopSession = () => {
      clearTimeout(idleT); clearTimeout(hiddenT);
      evs.forEach((ev) => window.removeEventListener(ev, reset));
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  /* ---------- start ---------- */
  document.body.prepend(
    svgFrom(DEFS),
    el('div', { class: 'backdrop', 'aria-hidden': 'true' }, [mandala('m1'), mandala('m2'), embers()])
  );

  // Coming back from the browser's back-forward cache must never show a signed-in page.
  window.addEventListener('pageshow', (e) => { if (e.persisted && user) showLogin(''); });

  // Web fonts are optional styling. They load after the page is drawn and never block it.
  try {
    document.head.appendChild(el('link', { rel: 'stylesheet', href: FONTS_URL }));
  } catch (_) { /* the fallback fonts are used */ }

  showLogin('');
})();
