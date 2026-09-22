/* Grandma AI — shared helpers. Loaded first; everything hangs off window.GA. */
(function () {
  "use strict";
  const GA = (window.GA = window.GA || {});

  const U = {};

  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  U.uid = (prefix = "") => {
    const rand = crypto.getRandomValues(new Uint32Array(2));
    return prefix + Date.now().toString(36) + rand[0].toString(36) + rand[1].toString(36).slice(0, 4);
  };

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  U.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  /* Tiny, safe markdown: escapes first, then applies a small subset. */
  U.md = (src) => {
    const lines = U.esc(src || "").split(/\r?\n/);
    const out = [];
    let list = null;
    const inline = (t) =>
      t
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
        .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>");
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
        if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
        out.push(`<li>${inline(m[2])}</li>`);
      } else if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
        closeList();
        out.push(`<h4>${inline(m[1])}</h4>`);
      } else if (!line.trim()) {
        closeList();
        out.push("");
      } else {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join("\n").replace(/<\/p>\n<p>/g, "</p><p>");
  };

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  U.dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  U.today = () => U.dateKey(new Date());
  U.parseKey = (k) => {
    const [y, m, d] = String(k).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  U.addDays = (key, n) => {
    const d = U.parseKey(key);
    d.setDate(d.getDate() + n);
    return U.dateKey(d);
  };
  U.addMonths = (key, n) => {
    const d = U.parseKey(key);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return U.dateKey(d);
  };
  U.isValidKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k || "") && !isNaN(U.parseKey(k));
  U.isValidTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
  U.friendlyDate = (key) => {
    if (!key) return "";
    const t = U.today();
    if (key === t) return "Today";
    if (key === U.addDays(t, 1)) return "Tomorrow";
    if (key === U.addDays(t, -1)) return "Yesterday";
    const d = U.parseKey(key);
    const diff = (d - U.parseKey(t)) / 86400000;
    if (diff > 0 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  U.friendlyTime = (hhmm) => {
    if (!U.isValidTime(hhmm)) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  U.nowTime = () => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  U.greetingWord = () => {
    const h = new Date().getHours();
    if (h < 5) return "Up late";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };
  U.relTime = (ts) => {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  /* ---------- quantities ---------- */
  const FRACTIONS = [[0.125, "⅛"], [0.25, "¼"], [0.333, "⅓"], [0.5, "½"], [0.667, "⅔"], [0.75, "¾"]];
  U.formatQty = (q) => {
    if (q == null || q === "" || isNaN(q)) return "";
    q = Number(q);
    if (q <= 0) return "";
    const whole = Math.floor(q + 1e-6);
    const frac = q - whole;
    if (frac < 0.06) return String(whole || "");
    if (frac > 0.94) return String(whole + 1);
    let best = FRACTIONS[0];
    for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
    if (Math.abs(best[0] - frac) > 0.07) return String(Math.round(q * 10) / 10);
    return (whole ? whole + " " : "") + best[1];
  };

  /* ---------- misc ---------- */
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  U.clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  U.truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  U.money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
  U.prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Downscale an image File/Blob to a JPEG Blob no larger than maxDim. */
  U.resizeImage = (file, maxDim = 1568, quality = 0.85) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read image"))), "image/jpeg", quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read image"));
      };
      img.src = url;
    });

  U.blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  /* ---------- toasts ---------- */
  U.toast = (msg, opts = {}) => {
    const host = U.$("#toasts");
    if (!host) return;
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.innerHTML = `<span>${U.esc(msg)}</span>`;
    if (opts.action) {
      const b = document.createElement("button");
      b.className = "toast-action";
      b.textContent = opts.action.label;
      b.onclick = () => {
        opts.action.run();
        t.remove();
      };
      t.appendChild(b);
    }
    host.appendChild(t);
    setTimeout(() => t.classList.add("leaving"), opts.ms || 3200);
    setTimeout(() => t.remove(), (opts.ms || 3200) + 400);
  };

  /* ---------- icons (hand-drawn, 24px, stroke-based) ---------- */
  const P = {
    chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/>',
    pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 10h20"/><path d="M9 6c0-1 .6-1.6 0-3M12 6c0-1 .6-1.6 0-3M15 6c0-1 .6-1.6 0-3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.2l2.8 2.8L16.5 9.3"/>',
    cart: '<path d="M3 4h2.2l2.3 11h10.2l2.1-7.5H6.4"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="16.5" cy="19.5" r="1.4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/><path d="M12 7.5c-.9-1.2-3-.8-3 .9 0 1.6 3 3.1 3 3.1s3-1.5 3-3.1c0-1.7-2.1-2.1-3-.9z"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    send: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    sidebar: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9.5 4v16"/>',
    trash: '<path d="M4 7h16M10 3.5h4M6.5 7l.9 12a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12"/>',
    edit: '<path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronLeft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    chevronRight: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    refresh: '<path d="M19.5 8A8 8 0 0 0 5 7.5M4.5 16A8 8 0 0 0 19 16.5"/><path d="M19.5 3.5V8H15M4.5 20.5V16H9"/>',
    flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-4.8 5-6.6 5-11.3 2.9 1.7 4.2 4.4 4 7 1-.5 1.8-1.6 2-2.8 1.4 1.4 2 3.4 2 5.5C18.5 18.4 15.9 21 12 21z"/>',
    timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5"/>',
    bookmark: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
    home: '<path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    upload: '<path d="M12 15.5V4M7 8.5l5-5 5 5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
    download: '<path d="M12 4v11.5M7 10.5l5 5 5-5M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
    logout: '<path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3.2 3.2 0 0 0 9 18a2.5 2.5 0 0 0 3 1.5V6a2.5 2.5 0 0 0-3-1.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3A3.2 3.2 0 0 1 15 18a2.5 2.5 0 0 1-3 1.5"/>',
  };
  U.icon = (name, cls = "") =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

  /* The Grandma avatar (assets/logo/avatar.png), always shown as a circle. */
  U.avatar = (size = 32, extra = "") =>
    `<span class="avatar ${extra}" style="width:${size}px;height:${size}px" aria-hidden="true"><img src="assets/logo/avatar.png" alt="" width="${size}" height="${size}" decoding="async"></span>`;

  /* ---------- modal / sheet ---------- */
  U.openSheet = ({ title, body, onMount, wide = false }) => {
    const host = U.$("#sheet-host");
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `
      <div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
        <div class="sheet-head">
          <h3>${U.esc(title)}</h3>
          <button class="icon-btn" data-close aria-label="Close">${U.icon("x")}</button>
        </div>
        <div class="sheet-body">${body}</div>
      </div>`;
    const close = () => {
      wrap.classList.add("leaving");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => wrap.remove(), 180);
    };
    const onKey = (e) => e.key === "Escape" && close();
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-close]")) close();
    });
    document.addEventListener("keydown", onKey);
    host.appendChild(wrap);
    const sheet = wrap.querySelector(".sheet");
    if (onMount) onMount(sheet, close);
    const first = sheet.querySelector("input, textarea, select");
    if (first && window.matchMedia("(pointer: fine)").matches) setTimeout(() => first.focus(), 60);
    return close;
  };

  U.confirm = (message, { okLabel = "Delete", danger = true } = {}) =>
    new Promise((resolve) => {
      let answered = false;
      U.openSheet({
        title: "Are you sure?",
        body: `<p class="muted">${U.esc(message)}</p>
          <div class="sheet-actions">
            <button class="btn ghost" data-no>Cancel</button>
            <button class="btn ${danger ? "danger" : "primary"}" data-yes>${U.esc(okLabel)}</button>
          </div>`,
        onMount(sheet, close) {
          sheet.querySelector("[data-yes]").onclick = () => { answered = true; resolve(true); close(); };
          sheet.querySelector("[data-no]").onclick = () => { answered = true; resolve(false); close(); };
          const obs = new MutationObserver(() => {
            if (!document.body.contains(sheet)) { obs.disconnect(); if (!answered) resolve(false); }
          });
          obs.observe(document.body, { childList: true, subtree: true });
        },
      });
    });

  GA.U = U;
})();
