/* Grandma AI — Settings, Profile, and the pricing page ("Choose your Grandma"). */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = window.GRANDMA_CONFIG || {};

  const MEM_CATS = { name: "Name", likes: "Likes", dislikes: "Dislikes", diet: "Diet", skill: "Skill", routine: "Routine", household: "Household", style: "Style", other: "Other" };

  const initials = (name, email) => {
    const s = (name || email || "?").trim();
    const parts = s.split(/\s+/);
    return ((parts[0] || "")[0] + ((parts[1] || "")[0] || "")).toUpperCase() || "?";
  };

  const sw = (name, checked, attrs = "") => `<label class="switch"><input type="checkbox" data-set="${name}" ${checked ? "checked" : ""} ${attrs}><span></span></label>`;

  /* ================= Settings ================= */
  function settingsHTML() {
    const p = Store.doc("profile");
    const s = Store.doc("settings");
    const plan = GA.Plans.current();
    const signedIn = GA.Account.signedIn();
    const mem = Store.list("memory");
    const memLimit = GA.Plans.limit("memory");
    const hh = Store.doc("household");
    const voices = GA.Voice.voices();
    const notif = s.notifications;
    const perm = GA.Notify.permission();
    const aiMode = GA.AI.mode();
    const ollama = GA.Ollama.cfg();

    return `
      <div class="page-inner">
        <div class="page-head"><div><h2>Settings</h2></div></div>

        <div class="section-title" id="set-account">Account</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Name</b><small>What Grandma calls you</small></div><input class="input" data-profile="name" value="${U.esc(p.name)}" placeholder="Your name" maxlength="40" style="max-width:180px"></div>
          ${signedIn
            ? `<div class="set-row"><div class="l"><b>Email</b></div><span class="v">${U.esc(GA.Account.email())}</span></div>
               <button class="set-row link" data-signout><div class="l"><b>Sign out</b><small>Your data stays safe in your account</small></div>${U.icon("logout")}</button>`
            : GA.Account.configured()
              ? `<div class="set-row"><div class="l"><b>Not signed in</b><small>Sign in to keep everything in sync across devices.</small></div><button class="btn small primary" data-auth="login">Sign in</button></div>`
              : `<div class="set-row"><div class="l"><b>This device only</b><small>Your data is stored privately on this device. Accounts and sync appear once the app's owner connects a database.</small></div></div>`}
        </div>

        <div class="section-title" id="set-ai">Grandma's AI</div>
        <div class="settings-group">
          ${aiMode === "proxy"
            ? `<div class="set-row"><div class="l"><b>Status</b><small>Connected through this app's server.</small></div><span class="v">🟢 On</span></div>`
            : `<div class="set-row"><div class="l"><b>Ollama on this computer</b><small data-ollama-status>${aiMode === "ollama" ? "Checking…" : "Not set up yet — free, private, no API key."}</small></div>
                 <button class="btn small ${aiMode === "ollama" ? "" : "primary"}" data-ollama-setup>${aiMode === "ollama" ? "Run setup again" : "Set up Grandma"}</button></div>
               ${aiMode === "ollama" ? `
               <div class="set-row"><div class="l"><b>Chat model</b><small>What Grandma thinks with</small></div><select class="select" data-ollama-model><option>${U.esc(ollama.model)}</option></select></div>
               <div class="set-row"><div class="l"><b>Photo model</b><small>Reads recipe cards and photos</small></div><select class="select" data-ollama-vision><option value="${U.esc(ollama.visionModel)}">${U.esc(ollama.visionModel || "Off")}</option></select></div>
               <div class="set-row"><div class="l"><b>Ollama address</b><small>Only change this if you know you need to</small></div><input class="input" data-ollama-url value="${U.esc(ollama.url)}" spellcheck="false" style="max-width:220px"></div>` : ""}`}
        </div>

        <div class="section-title" id="set-grandma">Grandma</div>
        <div class="settings-group">
          <div class="set-row" style="border-bottom:0;padding-bottom:0"><div class="l"><b>Personality</b><small>Changes Grandma's tone — never her honesty or care.</small></div></div>
          <div class="tone-grid">${Object.entries(GA.AI.TONES).map(([k, t]) => `<button class="tone ${p.personality === k ? "on" : ""}" data-tone="${k}" aria-pressed="${p.personality === k}"><b>${U.esc(t.label)}</b><small>${U.esc(t.blurb)}</small></button>`).join("")}</div>
        </div>

        <div class="section-title" id="set-voice">Voice</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Speak to Grandma</b><small>${GA.Voice.canListen() ? "Use the microphone button to talk" : "Not supported in this browser"}</small></div>${sw("voice.input", s.voice.input, GA.Voice.canListen() ? "" : "disabled")}</div>
          <div class="set-row"><div class="l"><b>Hear Grandma respond</b><small>${plan.voiceReplies ? "Grandma reads her replies aloud" : "Voice conversations come with Grandma+"}</small></div>
            ${plan.voiceReplies ? sw("voice.replies", s.voice.replies, GA.Voice.canSpeak() ? "" : "disabled") : `<button class="btn small" data-route="pricing">${U.icon("lock")}Grandma+</button>`}</div>
          ${GA.Voice.canSpeak() ? `<div class="set-row"><div class="l"><b>Voice</b></div>
            <select class="select" data-voice-select><option value="">Automatic</option>${voices.map((v) => `<option value="${U.esc(v.voiceURI)}" ${s.voice.voiceURI === v.voiceURI ? "selected" : ""}>${U.esc(v.name)}</option>`).join("")}</select></div>
          <div class="set-row"><div class="l"><b>Speaking speed</b></div><input type="range" min="0.7" max="1.3" step="0.05" value="${s.voice.rate}" data-voice-rate aria-label="Speaking speed" style="accent-color:var(--accent)"><button class="btn small ghost" data-voice-test>${U.icon("volume")}Test</button></div>` : ""}
        </div>

        <div class="section-title" id="set-appearance">Appearance</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Theme</b></div>
            <div class="segmented" role="radiogroup">${["system", "light", "dark"].map((t) => `<button class="${s.theme === t ? "on" : ""}" data-theme-set="${t}" role="radio" aria-checked="${s.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
        </div>

        <div class="section-title" id="set-memory">Memory <span class="count">${mem.length}${memLimit === Infinity ? "" : " / " + memLimit}</span></div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Let Grandma remember things</b><small>Useful preferences like foods you love or dislike. Never passwords, money, or health details.</small></div>${sw("memoryEnabled", s.memoryEnabled)}</div>
          ${mem.length ? `<ul class="memory-list">${mem.map((m) => `<li><span class="tag">${U.esc(MEM_CATS[m.category] || "Other")}</span><span class="f">${U.esc(m.fact)}</span><button class="icon-btn" data-mem-edit="${m.id}" aria-label="Edit">${U.icon("edit")}</button><button class="icon-btn" data-mem-del="${m.id}" aria-label="Delete">${U.icon("trash")}</button></li>`).join("")}</ul>`
            : `<div class="set-row"><div class="l"><small>Nothing remembered yet. Tell Grandma things like “I don't like onions” and she'll keep it in mind.</small></div></div>`}
          <div class="set-row"><button class="btn small" data-mem-add ${mem.length >= memLimit ? "disabled" : ""}>${U.icon("plus")}Add a memory</button>${mem.length ? `<span class="grow"></span><button class="btn small ghost" data-mem-clear>Forget everything</button>` : ""}</div>
        </div>

        <div class="section-title" id="set-notifications">Notifications</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Friendly notifications</b><small>${perm === "unsupported" ? "Not supported in this browser" : perm === "denied" ? "Blocked in your browser settings" : "Reminders and gentle nudges from Grandma"}</small></div>${sw("notifications.enabled", notif.enabled && perm === "granted", perm === "unsupported" || perm === "denied" ? "disabled" : "")}</div>
          <div class="set-row"><div class="l"><b>How often</b></div><select class="select" data-set-select="notifications.frequency">
            ${[["light", "Just reminders"], ["normal", "Reminders + encouragement"], ["off", "Off"]].map(([v, l]) => `<option value="${v}" ${notif.frequency === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="set-row"><div class="l"><b>Daily reminders</b><small>A morning check-in</small></div><input class="input" type="time" data-set-time="notifications.dailyTime" value="${notif.dailyTime}" style="min-width:0;width:120px">${sw("notifications.daily", notif.daily)}</div>
          <div class="set-row"><div class="l"><b>Task reminders</b><small>When a “remind me” task is due</small></div>${sw("notifications.tasks", notif.tasks)}</div>
          <div class="set-row"><div class="l"><b>Recipe reminders</b><small>A nudge before dinner time</small></div><input class="input" type="time" data-set-time="notifications.dinnerTime" value="${notif.dinnerTime}" style="min-width:0;width:120px">${sw("notifications.recipes", notif.recipes)}</div>
          ${notif.enabled && perm === "granted" ? `<div class="set-row"><button class="btn small ghost" data-notify-test>${U.icon("bell")}Send a test</button></div>` : ""}
        </div>

        <div class="section-title" id="set-subscription">Subscription</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Current plan</b><small>${U.esc(plan.name)}${Store.doc("subscription").period ? " · " + U.esc(Store.doc("subscription").period) : ""}</small></div><button class="btn small" data-route="pricing">See plans</button></div>
          ${plan.id !== "free" ? `<button class="set-row link" data-manage><div class="l"><b>Manage subscription</b></div>${U.icon("chevronRight")}</button>` : ""}
          <button class="set-row link" data-restore><div class="l"><b>Restore purchases</b></div>${U.icon("refresh")}</button>
        </div>

        <div class="section-title" id="set-household">Household</div>
        <div class="settings-group">
          ${hh.id
            ? `<div class="set-row"><div class="l"><b>${U.esc(hh.name)}</b><small>Shared: grocery list, Family Cookbook, and tasks you choose to share</small></div></div>
               <div class="set-row"><div class="l"><b>Invite code</b><small>Family members enter this under Settings → Household</small></div><span class="code-box">${U.esc(hh.inviteCode)}</span></div>
               <button class="set-row link" data-hh-leave><div class="l"><b>Leave household</b></div>${U.icon("logout")}</button>`
            : !GA.Account.configured()
              ? `<div class="set-row"><div class="l"><small>Households need accounts, which the app's owner hasn't set up on this server yet.</small></div></div>`
              : !signedIn
                ? `<div class="set-row"><div class="l"><b>Share with your family</b><small>Sign in to create or join a household.</small></div><button class="btn small" data-auth="login">Sign in</button></div>`
                : `<div class="set-row"><div class="l"><b>Create a household</b><small>${GA.Plans.atLeast("pro") ? "Share lists, chores, and the Family Cookbook" : "Included with Grandma Pro"}</small></div>${GA.Plans.atLeast("pro") ? `<button class="btn small primary" data-hh-create>Create</button>` : `<button class="btn small" data-route="pricing">${U.icon("lock")}Pro</button>`}</div>
                   <div class="set-row"><div class="l"><b>Join a household</b><small>Enter the invite code from a family member</small></div><button class="btn small" data-hh-join>Join</button></div>`}
        </div>

        <div class="section-title" id="set-privacy">Privacy & data</div>
        <div class="settings-group">
          <button class="set-row link" data-goto="set-memory"><div class="l"><b>Memory controls</b><small>See, edit, or delete what Grandma remembers</small></div>${U.icon("chevronRight")}</button>
          <button class="set-row link" data-export><div class="l"><b>Export my data</b><small>Download everything as a JSON file</small></div>${U.icon("download")}</button>
          <button class="set-row link" data-clear-convs><div class="l"><b>Delete all conversations</b></div>${U.icon("trash")}</button>
          <button class="set-row link" data-wipe><div class="l"><b style="color:var(--danger)">Delete all my data</b><small>${signedIn ? "Removes it from this device and your account" : "Removes everything from this device"}</small></div>${U.icon("trash")}</button>
        </div>

        <div class="section-title" id="set-about">About</div>
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Grandma AI</b><small>Grandma helps you take care of life.</small></div><span class="v">v1.0</span></div>
          <a class="set-row link" href="${U.esc(CFG.legal.termsUrl)}" target="_blank" rel="noopener"><div class="l"><b>Terms of Service</b></div>${U.icon("chevronRight")}</a>
          <a class="set-row link" href="${U.esc(CFG.legal.privacyUrl)}" target="_blank" rel="noopener"><div class="l"><b>Privacy Policy</b></div>${U.icon("chevronRight")}</a>
          ${CFG.legal.supportEmail ? `<a class="set-row link" href="mailto:${U.esc(CFG.legal.supportEmail)}"><div class="l"><b>Contact support</b></div>${U.icon("chevronRight")}</a>` : ""}
        </div>
        <p class="small-print">Grandma AI is an AI assistant with a grandmotherly personality — not a person, and not a doctor, therapist, lawyer, or financial advisor. For anything important, please check with a qualified professional.</p>
      </div>`;
  }

  function setPath(path, value) {
    const [root, ...rest] = path.split(".");
    let patch = value;
    for (let i = rest.length - 1; i >= 0; i--) patch = { [rest[i]]: patch };
    Store.setDoc("settings", rest.length ? { [root]: patch } : { [root]: value });
  }

  function wireSettings(root) {
    root.onclick = async (e) => {
      const t = e.target.closest("[data-tone]");
      if (t) {
        Store.setDoc("profile", { personality: t.dataset.tone });
        U.toast(`Grandma will be ${GA.AI.TONES[t.dataset.tone].label.toLowerCase()}.`);
        return;
      }
      const th = e.target.closest("[data-theme-set]");
      if (th) return GA.App.setTheme(th.dataset.themeSet);
      if (e.target.closest("[data-voice-test]")) return GA.Voice.speak("Hi there. This is how I'll sound when I read my replies to you.");
      if (e.target.closest("[data-notify-test]")) return GA.Notify.test();
      if (e.target.closest("[data-signout]")) {
        await GA.Account.signOut();
        U.toast("Signed out");
        return GA.App.go("chat");
      }
      if (e.target.closest("[data-manage]")) return GA.Plans.manage();
      if (e.target.closest("[data-restore]")) return GA.Plans.restore();
      const g = e.target.closest("[data-goto]");
      if (g) return document.getElementById(g.dataset.goto).scrollIntoView({ behavior: "smooth" });

      const md = e.target.closest("[data-mem-del]");
      if (md) return Store.remove("memory", md.dataset.memDel);
      const me = e.target.closest("[data-mem-edit]");
      if (me) return memoryForm(Store.find("memory", me.dataset.memEdit));
      if (e.target.closest("[data-mem-add]")) return memoryForm(null);
      if (e.target.closest("[data-mem-clear]") && (await U.confirm("Forget everything Grandma remembers about you?", { okLabel: "Forget everything" }))) {
        Store.list("memory").forEach((m) => Store.remove("memory", m.id));
        return;
      }

      if (e.target.closest("[data-hh-create]")) return householdCreate();
      if (e.target.closest("[data-hh-join]")) return householdJoin();
      if (e.target.closest("[data-hh-leave]") && (await U.confirm("Leave this household? Shared lists will stay with the household.", { okLabel: "Leave" }))) {
        try {
          await GA.Account.leaveHousehold();
          U.toast("You left the household");
        } catch (err) {
          U.toast("Couldn't leave right now. Try again.");
        }
        return;
      }

      if (e.target.closest("[data-export]")) {
        const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `grandma-ai-data-${U.today()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return;
      }
      if (e.target.closest("[data-clear-convs]") && (await U.confirm("Delete all conversations? Your tasks, recipes, and lists stay."))) {
        for (const c of Store.list("conversations")) await Store.deleteConv(c.id);
        GA.Chat.newChat();
        U.toast("Conversations deleted");
        return;
      }
      if (e.target.closest("[data-wipe]") && (await U.confirm("Delete all your Grandma AI data? This can't be undone.", { okLabel: "Delete everything" }))) {
        if (GA.Account.signedIn()) {
          await GA.Account.deleteAccountData().catch(() => {});
          await GA.Account.signOut({ skipPush: true });
        } else await Store.wipe();
        U.toast("All data deleted");
        location.hash = "#/chat";
        location.reload();
      }
    };

    root.onchange = async (e) => {
      const s = e.target.closest("[data-set]");
      if (s) {
        const path = s.dataset.set;
        if (path === "notifications.enabled" && s.checked) {
          const ok = await GA.Notify.enable();
          if (!ok) {
            s.checked = false;
            U.toast("Notifications are blocked. You can allow them in your browser settings.");
          }
          return;
        }
        if (path === "voice.replies" && s.checked && !GA.Plans.current().voiceReplies) {
          s.checked = false;
          return GA.App.go("pricing");
        }
        setPath(path, s.checked);
        return;
      }
      const sel = e.target.closest("[data-set-select]");
      if (sel) return setPath(sel.dataset.setSelect, sel.value);
      const tm = e.target.closest("[data-set-time]");
      if (tm && U.isValidTime(tm.value)) return setPath(tm.dataset.setTime, tm.value);
      const vs = e.target.closest("[data-voice-select]");
      if (vs) return setPath("voice.voiceURI", vs.value);
      const vr = e.target.closest("[data-voice-rate]");
      if (vr) return setPath("voice.rate", Number(vr.value));
      const om = e.target.closest("[data-ollama-model]");
      if (om) return GA.Ollama.save({ model: om.value });
      const ov = e.target.closest("[data-ollama-vision]");
      if (ov) return GA.Ollama.save({ visionModel: ov.value });
      const ou = e.target.closest("[data-ollama-url]");
      if (ou) return GA.Ollama.save({ url: ou.value.trim() || GA.Ollama.DEFAULT_URL });
      const pn = e.target.closest("[data-profile]");
      if (pn) Store.setDoc("profile", { [pn.dataset.profile]: pn.value.trim() });
    };
  }

  /* Show Ollama's live status and the models actually installed. */
  async function fillOllama(root) {
    const st = U.$("[data-ollama-status]", root);
    if (!st || GA.AI.mode() !== "ollama") return;
    const [s, models] = await Promise.all([GA.Ollama.status(), GA.Ollama.installed()]);
    st.textContent = s.state === "ok" ? `🟢 Running${s.version ? " · Ollama " + s.version : ""}` : s.state === "blocked" ? "🟠 Running, but needs permission for this website — run setup again" : "⚪ Not running — open the Ollama app";
    const c = GA.Ollama.cfg();
    const opts = (list, cur, off) => (off ? `<option value="">Off</option>` : "") + [...new Set(list.concat(cur ? [cur] : []))].map((m) => `<option ${m === cur ? "selected" : ""}>${U.esc(m)}</option>`).join("");
    const sm = U.$("[data-ollama-model]", root);
    const sv = U.$("[data-ollama-vision]", root);
    if (sm && models.length) sm.innerHTML = opts(models, c.model, false);
    if (sv && models.length) sv.innerHTML = opts(models, c.visionModel, true);
  }

  function memoryForm(m) {
    U.openSheet({
      title: m ? "Edit memory" : "Add a memory",
      body: `<form id="mem-form">
          <label class="field"><span>Kind</span><select class="select" name="category">${Object.entries(MEM_CATS).map(([k, l]) => `<option value="${k}" ${m && m.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>What should Grandma remember?</span><input class="input" name="fact" required maxlength="160" value="${U.esc(m ? m.fact : "")}" placeholder="Doesn't like onions"></label>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#mem-form");
        f.onsubmit = (e) => {
          e.preventDefault();
          const data = { category: f.category.value, fact: f.fact.value.trim() };
          if (!data.fact) return;
          if (m) Store.update("memory", m.id, data);
          else Store.add("memory", data);
          close();
        };
      },
    });
  }

  function householdCreate() {
    U.openSheet({
      title: "Create a household",
      body: `<form id="hh-form"><p class="muted">Everyone in your household shares one grocery list, the Family Cookbook, and any tasks you choose to share.</p>
          <label class="field" style="margin-top:12px"><span>Household name</span><input class="input" name="name" required maxlength="60" placeholder="The Johnson Family"></label>
          <p class="form-error" hidden></p>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#hh-form");
        f.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await GA.Account.createHousehold(f.name.value.trim());
            close();
            U.toast("Household created. Share your invite code!");
          } catch (err) {
            const p = f.querySelector(".form-error");
            p.hidden = false;
            p.textContent = err.message || "Couldn't create it right now.";
          }
        };
      },
    });
  }

  function householdJoin() {
    U.openSheet({
      title: "Join a household",
      body: `<form id="hh-join"><label class="field"><span>Invite code</span><input class="input" name="code" required maxlength="12" style="text-transform:uppercase;letter-spacing:.12em" autocomplete="off"></label>
          <p class="muted" style="font-size:14px">Your grocery list and Family Cookbook will switch to the household's shared ones.</p>
          <p class="form-error" hidden></p>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Join</button></div></form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#hh-join");
        f.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await GA.Account.joinHousehold(f.code.value);
            close();
            U.toast("Welcome to the household ❤️");
          } catch (err) {
            const p = f.querySelector(".form-error");
            p.hidden = false;
            p.textContent = "That code didn't work. Double-check it and try again.";
          }
        };
      },
    });
  }

  /* ================= Profile ================= */
  function profileHTML() {
    const p = Store.doc("profile");
    const s = Store.doc("settings");
    const plan = GA.Plans.current();
    const email = GA.Account.email() || p.email;
    const tone = GA.AI.TONES[p.personality] || GA.AI.TONES.warm;
    const row = (label, value, target) => `<button class="set-row link" data-goto-set="${target}"><div class="l"><b>${label}</b><small>${U.esc(value)}</small></div>${U.icon("chevronRight")}</button>`;
    return `
      <div class="page-inner">
        <div class="page-head"><div><h2>Profile</h2></div></div>
        <div class="profile-card">
          <div class="initials">${U.esc(initials(p.name, email))}</div>
          <div class="grow">
            <h3>${U.esc(p.name || "Friend")}</h3>
            <div class="muted" style="font-size:14.5px">${email ? U.esc(email) : GA.Account.configured() ? "Not signed in" : "Using this device only"}</div>
            <span class="plan-badge ${plan.id !== "free" ? "paid" : ""}">${U.esc(plan.name)}</span>
          </div>
        </div>
        ${!GA.Account.signedIn() && GA.Account.configured() ? `<div class="row wrap" style="margin-bottom:18px"><button class="btn primary" data-auth="signup">Create account</button><button class="btn" data-auth="login">Sign in</button></div>` : ""}
        <div class="settings-group">
          <div class="set-row"><div class="l"><b>Name</b></div><span class="v">${U.esc(p.name || "—")}</span></div>
          <div class="set-row"><div class="l"><b>Email</b></div><span class="v">${U.esc(email || "—")}</span></div>
          <button class="set-row link" data-route="pricing"><div class="l"><b>Subscription</b><small>${U.esc(plan.name)}</small></div>${U.icon("chevronRight")}</button>
        </div>
        <div class="section-title">Preferences</div>
        <div class="settings-group">
          ${row("Grandma personality", tone.label, "set-grandma")}
          ${row("Voice settings", (s.voice.input ? "Voice input on" : "Voice input off") + (plan.voiceReplies ? (s.voice.replies ? " · spoken replies on" : " · spoken replies off") : ""), "set-voice")}
          ${row("Memory settings", s.memoryEnabled ? `${Store.list("memory").length} things remembered` : "Memory off", "set-memory")}
          ${row("Notifications", s.notifications.enabled ? "On" : "Off", "set-notifications")}
          ${row("Privacy", "Your data, exports, and deletion", "set-privacy")}
        </div>
        ${GA.Account.signedIn() ? `<div class="row" style="margin-top:18px"><button class="btn ghost" data-signout>${U.icon("logout")}Sign out</button></div>` : ""}
      </div>`;
  }

  /* ================= Pricing ================= */
  let period = "monthly";

  function priceBlock(plan) {
    if (!plan.monthly) return `<div class="price"><b>$0</b><span>/month</span></div><div class="price-note">Free forever</div>`;
    if (period === "monthly") return `<div class="price"><b>${U.money(plan.monthly)}</b><span>/month</span></div><div class="price-note">Billed monthly · cancel anytime</div>`;
    return `<div class="price"><b>${U.money(GA.Plans.yearlyPrice(plan))}</b><span>/year</span></div>
      <div class="price-note">That's ${U.money(GA.Plans.yearlyMonthlyEquivalent(plan))}/month, billed once a year (vs. ${U.money(plan.monthly * 12)} paying monthly)</div>`;
  }

  function pricingHTML() {
    const cur = GA.Plans.current();
    const P = GA.Plans.PLANS;
    const cta = (plan) => {
      if (cur.id === plan.id) return `<button class="btn block" disabled>Current plan</button>`;
      if (plan.id === "free") return cur.id === "free" ? "" : `<button class="btn block ghost" data-manage>Manage subscription</button>`;
      return `<button class="btn block ${plan.badge ? "primary" : ""}" data-buy="${plan.id}">${U.esc(plan.cta)}</button>`;
    };
    return `
      <div class="page-inner wide">
        <div class="pricing-head">
          <h2>Choose your Grandma</h2>
          <p>Start free. Upgrade when you want Grandma to do more.</p>
        </div>
        <div class="billing-toggle">
          <div class="segmented" role="radiogroup" aria-label="Billing period">
            <button class="${period === "monthly" ? "on" : ""}" data-period="monthly" role="radio" aria-checked="${period === "monthly"}">Monthly</button>
            <button class="${period === "yearly" ? "on" : ""}" data-period="yearly" role="radio" aria-checked="${period === "yearly"}">Yearly</button>
          </div>
          <span class="save-badge">Save 20%${period === "yearly" ? "" : " yearly"}</span>
        </div>
        <div class="plans">
          ${[P.free, P.plus, P.pro].map((plan) => `
            <div class="plan ${plan.badge ? "popular" : ""} ${cur.id === plan.id ? "current" : ""}">
              ${plan.badge ? `<span class="badge">${plan.badge}</span>` : ""}
              <h3>${U.esc(plan.name)}</h3>
              <p class="tagline">${U.esc(plan.tagline)}</p>
              ${priceBlock(plan)}
              ${plan.id === "free" && cur.id === "free" ? `<button class="btn block" data-route="chat">${U.esc(plan.cta)}</button>` : cta(plan)}
              <ul>${plan.features.map((f) => `<li>${U.icon("check")}<span>${U.esc(f)}</span></li>`).join("")}</ul>
            </div>`).join("")}
        </div>
        <div class="pricing-foot">
          <button class="btn ghost" data-restore>${U.icon("refresh")}Restore Purchases</button>
          <div class="links"><a href="${U.esc(CFG.legal.termsUrl)}" target="_blank" rel="noopener">Terms of Service</a><a href="${U.esc(CFG.legal.privacyUrl)}" target="_blank" rel="noopener">Privacy Policy</a></div>
          <p class="fine">Prices in US dollars. Subscriptions renew automatically at the same price and period until cancelled; cancel anytime before renewal and you keep access until the end of the paid period. Yearly plans include the same features as monthly plans. Taxes may apply. Purchases in the iOS or Android app are billed by Apple or Google.</p>
        </div>
      </div>`;
  }

  function wirePricing(root) {
    root.onclick = (e) => {
      const p = e.target.closest("[data-period]");
      if (p) {
        period = p.dataset.period;
        root.innerHTML = pricingHTML();
        return;
      }
      const b = e.target.closest("[data-buy]");
      if (b) return GA.Plans.purchase(b.dataset.buy, period);
      if (e.target.closest("[data-restore]")) return GA.Plans.restore();
      if (e.target.closest("[data-manage]")) return GA.Plans.manage();
    };
  }

  GA.Views = GA.Views || {};
  GA.Views.settings = {
    title: "Settings",
    keys: ["settings", "profile", "memory", "subscription", "household", "local"],
    render(root, params) {
      root.innerHTML = settingsHTML();
      wireSettings(root);
      fillOllama(root);
      const section = params[0];
      if (section) {
        const el = document.getElementById("set-" + section);
        if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 30);
      }
    },
    refresh(root) {
      // Don't yank the page while someone is typing in a field.
      if (root.contains(document.activeElement) && document.activeElement.matches("input:not([type=checkbox]), textarea, select")) return;
      const y = root.scrollTop;
      root.innerHTML = settingsHTML();
      root.scrollTop = y;
      fillOllama(root);
    },
  };
  GA.Views.profile = {
    title: "Profile",
    keys: ["settings", "profile", "memory", "subscription"],
    render(root) {
      root.innerHTML = profileHTML();
      root.onclick = async (e) => {
        const g = e.target.closest("[data-goto-set]");
        if (g) GA.App.go("settings/" + g.dataset.gotoSet.replace("set-", ""));
        if (e.target.closest("[data-signout]")) {
          await GA.Account.signOut();
          GA.App.go("chat");
        }
      };
    },
  };
  GA.Views.pricing = {
    title: "Grandma+",
    keys: ["subscription"],
    render(root, params) {
      if (params[0] === "yearly" || params[0] === "monthly") period = params[0];
      root.innerHTML = pricingHTML();
      wirePricing(root);
    },
  };
})();
