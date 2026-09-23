/*
 * Grandma AI — app shell: routing, sidebar, top bar, onboarding, sign-in,
 * theme, gestures, and the shared click handlers that make chat cards and
 * pages act on the same data.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = window.GRANDMA_CONFIG || {};

  const NAV = [
    ["chat", "chat", "Chat"],
    ["recipes", "pot", "Recipes"],
    ["tasks", "tasks", "Tasks"],
    ["grocery", "cart", "Grocery List"],
    ["planner", "calendar", "Planner"],
    ["cookbook", "book", "Family Cookbook"],
  ];
  const TITLES = { chat: "Grandma AI", recipes: "Recipes", tasks: "Tasks", grocery: "Grocery List", planner: "Planner", cookbook: "Family Cookbook", settings: "Settings", profile: "Profile", pricing: "Grandma+" };

  let route = "chat";
  let params = [];
  let ignoreHash = false;
  let convQuery = "";
  let showAllConvs = false;
  const renderQueue = new Set();

  /* ---------------- routing ---------------- */
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("?")[0];
    const [r, ...rest] = h.split("/").filter(Boolean);
    return { r: TITLES[r] ? r : "chat", p: rest };
  }

  function go(path) {
    const target = "#/" + path;
    if (location.hash === target) onHash();
    else location.hash = target;
  }

  function setRoute(path, { replace = false, silent = false } = {}) {
    const url = "#/" + path;
    if (silent) ignoreHash = true;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    if (silent) setTimeout(() => (ignoreHash = false), 0);
    else onHash();
    renderConvList();
  }

  function onHash() {
    if (ignoreHash) return;
    const { r, p } = parseHash();
    const prev = route;
    route = r;
    params = p;
    U.$$(".view").forEach((v) => (v.hidden = v.dataset.view !== r));
    U.$("#topbar").classList.remove("scrolled");
    closeNav();
    if (r === "chat") {
      GA.Chat.open(p[0] || null);
    } else {
      const root = U.$("#view-" + r);
      GA.Views[r].render(root, p);
      root.scrollTop = 0;
    }
    updateTopbar();
    updateNav();
    renderConvList();
    updateBanner();
    if (prev !== r) GA.Ads.maybeInterstitial(prev, r);
  }

  /* Re-render the visible page when its data changes (batched per frame). */
  function scheduleRefresh(key) {
    renderQueue.add(key);
    if (renderQueue.size > 1) return;
    requestAnimationFrame(() => {
      const keys = [...renderQueue];
      renderQueue.clear();
      if (route !== "chat") {
        const v = GA.Views[route];
        if (v && keys.some((k) => v.keys.includes(k) || k === "*")) {
          const root = U.$("#view-" + route);
          (v.refresh || v.render)(root, params);
        }
      }
      if (keys.some((k) => ["conversations", "*"].includes(k))) renderConvList();
      if (keys.some((k) => ["subscription", "profile", "local", "*"].includes(k))) {
        updateNav();
        updateTopbar();
      }
      if (keys.includes("settings") || keys.includes("*")) applyTheme();
      if (keys.some((k) => ["settings", "subscription", "*"].includes(k))) applyAccent();
    });
  }

  /* ---------------- sidebar ---------------- */
  function updateNav() {
    const counts = {
      tasks: Store.allTasks().filter((t) => !t.completed && t.dueDate && t.dueDate <= U.today()).length,
      grocery: Store.list("grocery").filter((g) => !g.checked).length,
    };
    U.$("#sb-nav").innerHTML = NAV.map(
      ([r, ic, label]) => `<a class="nav-item ${route === r ? "on" : ""}" href="#/${r}" data-route="${r}" ${route === r ? 'aria-current="page"' : ""}>${U.icon(ic)}<span>${label}</span>${counts[r] ? `<span class="count">${counts[r]}</span>` : ""}</a>`
    ).join("");
    const p = Store.doc("profile");
    const plan = GA.Plans.current();
    const email = GA.Account.email();
    U.$("#sb-bottom").innerHTML = `
      <a class="nav-item ${route === "settings" ? "on" : ""}" href="#/settings" data-route="settings">${U.icon("settings")}<span>Settings</span></a>
      <a class="nav-item ${route === "pricing" ? "on" : ""}" href="#/pricing" data-route="pricing">${U.icon("star")}<span>Grandma+</span>${plan.id === "free" ? `<span class="pill">Upgrade</span>` : ""}</a>
      <a class="nav-item ${route === "profile" ? "on" : ""}" href="#/profile" data-route="profile">
        <span class="sb-user"><span class="initials">${U.esc(((p.name || email || "?").trim()[0] || "?").toUpperCase())}</span>
        <span class="who"><b>${U.esc(p.name || "Profile")}</b><small>${U.esc(plan.name)}</small></span></span>
      </a>`;
  }

  function renderConvList() {
    const host = U.$("#conv-list");
    if (!host) return;
    const q = convQuery.toLowerCase();
    let convs = Store.list("conversations").sort((a, b) => (b.lastAt || b.updatedAt) - (a.lastAt || a.updatedAt));
    if (q) {
      convs = convs.filter((c) => {
        if (c.title.toLowerCase().includes(q)) return true;
        const msgs = Store.conv(c.id).messages || [];
        return msgs.some((m) => (m.text || "").toLowerCase().includes(q));
      });
    }
    if (!convs.length) {
      host.innerHTML = `<div class="conv-empty">${q ? "No conversations match." : "Your conversations will appear here."}</div>`;
      return;
    }
    const limit = showAllConvs || q ? convs.length : 8;
    const cur = route === "chat" ? GA.Chat.currentId() : null;
    host.innerHTML =
      convs.slice(0, limit).map((c) => `<div class="conv-item ${c.id === cur ? "on" : ""}" data-conv="${c.id}">
          <a href="#/chat/${c.id}" title="${U.esc(c.title)}">${U.esc(c.title)}</a>
          <button class="icon-btn conv-more" data-conv-menu="${c.id}" aria-label="Options for ${U.esc(c.title)}">${U.icon("more")}</button>
        </div>`).join("") +
      (convs.length > limit ? `<button class="link-btn show-more" data-show-all>Show ${convs.length - limit} more</button>` : "");
  }

  function convMenu(id) {
    const c = Store.find("conversations", id);
    if (!c) return;
    U.openSheet({
      title: "Conversation",
      body: `<form id="conv-form">
          <label class="field"><span>Name</span><input class="input" name="title" value="${U.esc(c.title)}" maxlength="80" required></label>
          <div class="sheet-actions split"><button type="button" class="btn ghost" data-del>${U.icon("trash")}Delete</button><button class="btn primary">Rename</button></div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#conv-form");
        f.onsubmit = (e) => {
          e.preventDefault();
          Store.update("conversations", id, { title: f.title.value.trim() || c.title });
          close();
        };
        sheet.querySelector("[data-del]").onclick = async () => {
          close();
          if (await U.confirm(`Delete "${c.title}"? This can't be undone.`)) {
            await Store.deleteConv(id);
            if (GA.Chat.currentId() === id) {
              GA.Chat.newChat();
              setRoute("chat", { replace: true, silent: true });
            }
            renderConvList();
          }
        };
      },
    });
  }

  const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;
  function openNav() {
    U.$("#app").classList.add("nav-open");
  }
  function closeNav() {
    U.$("#app").classList.remove("nav-open");
  }

  /* ---------------- top bar ---------------- */
  function updateTopbar() {
    const title = U.$("#topbar-title");
    const actions = U.$("#topbar-actions");
    if (!title) return;
    if (route === "chat") {
      const busy = GA.Chat.busy();
      const connected = GA.AI.connected();
      const brain = GA.AI.mode() === "local" ? GA.Brain.status() : null;
      const waking = brain && brain.state === "loading";
      const status = waking ? `Waking Grandma up… ${Math.round(brain.progress * 100)}%` : busy ? "Grandma is thinking…" : connected ? "Grandma is ready ❤️" : "Tap to turn Grandma on";
      title.innerHTML = `${U.avatar(32, busy ? "thinking" : "")}<div class="t-stack"><h1>Grandma AI</h1><span class="status ${busy || waking ? "busy" : connected ? "" : "off"}" ${connected ? "" : "data-brain-setup role=\"button\" tabindex=\"0\" style=\"cursor:pointer\""}>${status}</span></div>`;
      actions.innerHTML = `<button class="icon-btn" data-action="new-chat" aria-label="New conversation" title="New conversation">${U.icon("edit")}</button>`;
    } else {
      // Pages carry their own large heading; keep the bar quiet.
      title.innerHTML = isDesktop() ? "" : `<h1>${U.esc(TITLES[route])}</h1>`;
      actions.innerHTML = "";
    }
  }

  function updateBanner() {
    const b = U.$("#connection-banner");
    if (!navigator.onLine) {
      b.hidden = false;
      b.innerHTML = `${U.icon("info")}<span class="grow">You're offline. Your lists, recipes, and planner still work.</span>`;
      return;
    }
    b.hidden = true;
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    const t = Store.doc("settings").theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("grandma-theme", t); } catch (e) { /* ignore */ }
    const dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    U.$$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#1C1816" : "#FBF7F2"));
  }

  /* ---------------- onboarding & auth ---------------- */
  function onboarding() {
    U.openSheet({
      title: "Welcome",
      body: `<div class="onboard">
          ${U.avatar(72)}
          <h2>Hi, I'm Grandma.</h2>
          <p>I'm an AI assistant here to help you take care of life — recipes, chores, planning, groceries, and a little encouragement.</p>
          <form id="onboard-form">
            <label class="field"><span>What should I call you?</span><input class="input" name="name" maxlength="40" placeholder="Your name (optional)" autocomplete="given-name"></label>
            <div class="field-label" style="text-align:left;margin-bottom:8px">How should I talk to you?</div>
            <div class="tone-grid">${Object.entries(GA.AI.TONES).map(([k, t], i) => `<button type="button" class="tone ${i === 0 ? "on" : ""}" data-tone="${k}"><b>${U.esc(t.label)}</b><small>${U.esc(t.blurb)}</small></button>`).join("")}</div>
            <button class="btn primary block">Let's get started</button>
            ${GA.Account.configured() && !GA.Account.signedIn() ? `<p style="margin-top:12px;font-size:14px" class="muted">Already have an account? <button type="button" class="link-btn" data-login>Sign in</button></p>` : ""}
          </form>
        </div>`,
      onMount(sheet, close) {
        let tone = "warm";
        sheet.querySelector(".tone-grid").onclick = (e) => {
          const b = e.target.closest("[data-tone]");
          if (!b) return;
          tone = b.dataset.tone;
          U.$$(".tone", sheet).forEach((x) => x.classList.toggle("on", x === b));
        };
        const finish = (name) => {
          Store.setDoc("profile", { name: name || Store.doc("profile").name, personality: tone, onboarded: true });
        };
        sheet.querySelector("#onboard-form").onsubmit = (e) => {
          e.preventDefault();
          finish(e.target.name.value.trim());
          close();
          GA.Chat.render();
          if (!GA.AI.connected()) setTimeout(() => GA.Brain.openSetup({ onDone: () => GA.App.refreshAll() }), 250);
        };
        const login = sheet.querySelector("[data-login]");
        if (login) login.onclick = () => {
          finish("");
          close();
          openAuth("login");
        };
        // Closing the welcome any other way still counts as onboarded.
        const obs = new MutationObserver(() => {
          if (!document.body.contains(sheet)) {
            obs.disconnect();
            if (!Store.doc("profile").onboarded) finish("");
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      },
    });
  }

  function openAuth(mode = "login") {
    if (!GA.Account.configured()) {
      U.toast("Accounts aren't set up on this server yet — your data stays on this device.");
      return;
    }
    const googleSvg = `<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
    const body = (m) => `
      <form id="auth-form" data-mode="${m}">
        ${(CFG.supabase || {}).googleSignIn !== false ? `<button type="button" class="btn block google-btn" data-google>${googleSvg}Continue with Google</button><div class="divider">or with email</div>` : ""}
        ${m === "signup" ? `<label class="field"><span>Name</span><input class="input" name="name" autocomplete="name" maxlength="40" value="${U.esc(Store.doc("profile").name)}"></label>` : ""}
        <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required></label>
        ${m !== "reset" ? `<label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" minlength="8" required></label>` : ""}
        <p class="form-error" hidden></p><p class="form-ok" hidden></p>
        <button class="btn primary block">${m === "signup" ? "Create account" : m === "reset" ? "Send reset link" : "Sign in"}</button>
        <p class="muted" style="font-size:14px;margin-top:14px;text-align:center">
          ${m === "login" ? `New here? <button type="button" class="link-btn" data-switch="signup">Create an account</button> · <button type="button" class="link-btn" data-switch="reset">Forgot password?</button>` : `Already have an account? <button type="button" class="link-btn" data-switch="login">Sign in</button>`}
        </p>
        <p class="small-print" style="text-align:center">By continuing you agree to the <a href="${U.esc(CFG.legal.termsUrl)}" target="_blank" rel="noopener">Terms</a> and <a href="${U.esc(CFG.legal.privacyUrl)}" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      </form>`;
    const titles = { login: "Sign in", signup: "Create your account", reset: "Reset your password" };
    U.openSheet({
      title: titles[mode],
      body: body(mode),
      onMount(sheet, close) {
        const wire = () => {
          const f = sheet.querySelector("#auth-form");
          const err = f.querySelector(".form-error");
          const ok = f.querySelector(".form-ok");
          const g = f.querySelector("[data-google]");
          if (g) g.onclick = async () => {
            try { await GA.Account.signInWithGoogle(); } catch (e) { err.hidden = false; err.textContent = e.message; }
          };
          U.$$("[data-switch]", f).forEach((b) => (b.onclick = () => {
            sheet.querySelector(".sheet-head h3").textContent = titles[b.dataset.switch];
            sheet.querySelector(".sheet-body").innerHTML = body(b.dataset.switch);
            wire();
          }));
          f.onsubmit = async (e) => {
            e.preventDefault();
            err.hidden = ok.hidden = true;
            const m = f.dataset.mode;
            const btn = f.querySelector(".btn.primary");
            btn.disabled = true;
            try {
              if (m === "signup") {
                const res = await GA.Account.signUp(f.email.value.trim(), f.password.value, f.name.value.trim());
                if (res && res.session) { close(); U.toast("Welcome! Your account is ready ❤️"); }
                else { ok.hidden = false; ok.textContent = "Check your email to confirm your account, then sign in."; }
              } else if (m === "reset") {
                await GA.Account.resetPassword(f.email.value.trim());
                ok.hidden = false;
                ok.textContent = "If that email has an account, a reset link is on its way.";
              } else {
                await GA.Account.signIn(f.email.value.trim(), f.password.value);
                close();
                U.toast("Welcome back ❤️");
              }
            } catch (ex) {
              err.hidden = false;
              err.textContent = ex.message || "Something went wrong. Please try again.";
            } finally {
              btn.disabled = false;
            }
          };
        };
        wire();
      },
    });
  }

  /* Accent colors are a Grandma+ perk; everyone else keeps Grandma's coral. */
  function applyAccent() {
    const a = Store.doc("settings").accent;
    if (a && a !== "coral" && GA.Plans.can("accents")) document.documentElement.dataset.accent = a;
    else delete document.documentElement.dataset.accent;
  }
  function setAccent(a) {
    Store.setDoc("settings", { accent: a });
    applyAccent();
  }

  function setTheme(t) {
    Store.setDoc("settings", { theme: t });
    applyTheme();
  }

  function askGrandma(text) {
    if (route !== "chat" || GA.Chat.currentId()) {
      GA.Chat.newChat();
      go("chat");
    }
    setTimeout(() => GA.Chat.send(text), 30);
  }

  /* ---------------- global interactions ---------------- */
  function wireGlobal() {
    document.addEventListener("click", async (e) => {
      const r = e.target.closest("[data-route]");
      if (r && !e.defaultPrevented) {
        e.preventDefault();
        let path = r.dataset.route;
        if (r.dataset.highlight) path += "/" + r.dataset.highlight;
        if (r.dataset.date) path += "/" + r.dataset.date;
        if (r.dataset.section) path += "/" + r.dataset.section;
        if (U.$("#cook-host").children.length) GA.RecipeUI.Cook.close(true);
        go(path);
        return;
      }
      const a = e.target.closest("[data-ask]");
      if (a) {
        const text = a.dataset.ask;
        if (/:\s*$/.test(text)) {
          GA.Chat.newChat();
          go("chat");
          setTimeout(() => GA.Chat.prefill(text), 30);
        } else askGrandma(text);
        return;
      }
      const act = e.target.closest("[data-action]");
      if (act && act.dataset.action === "new-chat") {
        GA.Chat.newChat();
        setRoute("chat", { replace: route === "chat" });
        closeNav();
        return;
      }
      if (e.target.closest("[data-brain-setup]")) {
        GA.Brain.openSetup({ onDone: () => { GA.App.refreshAll(); GA.Chat.focus(); } });
        return;
      }
      const au = e.target.closest("[data-auth]");
      if (au) return openAuth(au.dataset.auth);
      const ra = e.target.closest("[data-recipe-action]");
      if (ra) return GA.RecipeUI.handle(ra.dataset.recipeAction, ra.dataset.id, ra);
      const mf = e.target.closest("[data-memory-forget]");
      if (mf) {
        Store.remove("memory", mf.dataset.memoryForget);
        U.toast("Forgotten");
        return;
      }
      const cm = e.target.closest("[data-conv-menu]");
      if (cm) {
        e.preventDefault();
        return convMenu(cm.dataset.convMenu);
      }
      const ca = e.target.closest(".conv-item a");
      if (ca) {
        e.preventDefault();
        go("chat/" + ca.closest(".conv-item").dataset.conv);
        return;
      }
      if (e.target.closest("[data-show-all]")) {
        showAllConvs = true;
        renderConvList();
      }
    });

    document.addEventListener("change", (e) => {
      const t = e.target.closest("[data-task-toggle]");
      if (t) {
        GA.TaskOps.setCompleted(t.dataset.taskToggle, t.checked);
        return;
      }
      const g = e.target.closest("[data-grocery-toggle]");
      if (g) Store.update("grocery", g.dataset.groceryToggle, { checked: g.checked });
    });

    U.$("#menu-btn").innerHTML = U.icon("menu");
    U.$("#menu-btn").onclick = openNav;
    U.$("#scrim").onclick = closeNav;
    U.$("#sb-collapse").innerHTML = U.icon("sidebar");
    U.$("#expand-btn").innerHTML = U.icon("sidebar");
    const setCollapsed = (v) => {
      U.$("#app").classList.toggle("sb-collapsed", v);
      Store.setDoc("local", { sidebarCollapsed: v });
    };
    U.$("#sb-collapse").onclick = () => setCollapsed(true);
    U.$("#expand-btn").onclick = () => setCollapsed(false);
    U.$(".new-chat .nc-icon").outerHTML = U.icon("plus");
    U.$(".sb-search-icon").outerHTML = U.icon("search");

    const search = U.$("#conv-search");
    search.addEventListener("input", U.debounce(() => {
      convQuery = search.value.trim();
      renderConvList();
    }, 120));

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        GA.Chat.newChat();
        go("chat");
      }
      if (e.key === "Escape") closeNav();
    });

    // One-handed navigation: swipe from the left edge to open the menu.
    let sx = null, sy = null, fromEdge = false;
    document.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      fromEdge = sx < 24;
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (sx == null || isDesktop()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
      const open = U.$("#app").classList.contains("nav-open");
      if (!open && fromEdge && dx > 60 && dy < 50) openNav();
      if (open && dx < -60 && dy < 50) closeNav();
      sx = null;
    }, { passive: true });

    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", updateBanner);
    window.addEventListener("offline", updateBanner);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.route) go(e.data.route);
      });
    }
  }

  async function handleCheckoutReturn() {
    const q = new URLSearchParams(location.search || location.hash.split("?")[1] || "");
    if (q.get("checkout") !== "success") return;
    history.replaceState(null, "", location.pathname + "#/pricing");
    U.toast("Thank you! Setting up your plan…");
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      await GA.Account.refreshSubscription();
      if (GA.Plans.current().id !== "free") {
        U.toast(`You're all set with ${GA.Plans.current().name} ❤️`);
        return;
      }
    }
    U.toast("Your payment went through. Your plan will appear in a minute or two.");
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    await Store.init();
    applyTheme();
    applyAccent();
    if (Store.doc("local").sidebarCollapsed) U.$("#app").classList.add("sb-collapsed");
    wireGlobal();
    GA.Chat.mount();
    Store.on("*", scheduleRefresh);
    await GA.Account.init();
    onHash();
    U.$("#app").dataset.loading = "false";
    GA.Notify.start();
    GA.Brain.onStatus(U.debounce(() => {
      updateTopbar();
      if (route === "settings") scheduleRefresh("local");
    }, 150));
    // Load Grandma's brain from the browser cache in the background.
    setTimeout(() => GA.AI.mode() === "local" && GA.Brain.preload(), 1500);
    if (!Store.doc("profile").onboarded) setTimeout(onboarding, 250);
    handleCheckoutReturn();
  }

  GA.App = {
    go,
    setRoute,
    currentRoute: () => route,
    updateTopbar,
    refreshAll: () => {
      onHash();
      updateNav();
    },
    openAuth,
    setTheme,
    setAccent,
    askGrandma,
    isDesktop,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
