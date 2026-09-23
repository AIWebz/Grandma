/*
 * Grandma AI — the conversation: empty/home state, messages, action cards,
 * composer (text, photos, voice), retries, and limits.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const PROMPTS = [
    ["🍲", "What's for dinner?"],
    ["🧹", "Help me clean my house"],
    ["🛒", "Make a grocery list"],
    ["📅", "Plan my day"],
    ["🥧", "Find me a traditional recipe"],
    ["❤️", "I need some encouragement"],
  ];

  const CAT_EMOJI = { cleaning: "🧹", laundry: "🧺", kitchen: "🍳", yard: "🌱", shopping: "🛒", pets: "🐶", household: "🏠", other: "📦" };

  let currentId = null;
  let busy = false;
  let pending = null; // { convId, text, cards } while Grandma is replying
  let ephemeral = null; // notice shown in the thread but not saved
  let attachments = []; // { id, url, blob }
  let abort = null;
  let lastInputVoice = false;
  let stopListening = null;
  const cardRegistry = new Map();

  const el = {};

  /* ---------------- helpers ---------------- */
  function todaysProgress() {
    const today = U.today();
    const tasks = Store.allTasks().filter((t) => t.dueDate === today || (t.completed && t.completedAt && U.dateKey(new Date(t.completedAt)) === today));
    return { done: tasks.filter((t) => t.completed).length, total: tasks.length };
  }

  function grandmaLine() {
    const { done, total } = todaysProgress();
    const tone = Store.doc("profile").personality;
    if (total && done === total) return tone === "funny" ? "Everything's checked off today. Look at you go — I might have to find you more chores." : "You've already taken care of everything today. I'm proud of you.";
    if (total - done === 1) return "Just one thing left on today's list. You've got this.";
    if (total) return tone === "practical" ? `${total - done} things left today. Let's knock them out.` : "We've got a few things to take care of today. One at a time.";
    const h = new Date().getHours();
    if (h >= 15 && h < 20) return "Getting close to dinner time. Want me to figure out what to make?";
    return "Nothing on the list yet. Let's make today a good one.";
  }

  function titleFrom(text) {
    const t = text.replace(/^(hey |hi |hello )?grandma[,!.\s]*/i, "").replace(/\s+/g, " ").trim();
    return U.truncate(t.charAt(0).toUpperCase() + t.slice(1) || "New conversation", 42);
  }

  const nearBottom = () => el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 120;
  const toBottom = (smooth) => el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior: smooth && !U.prefersReducedMotion() ? "smooth" : "auto" });

  /* ---------------- cards ---------------- */
  function renderCard(card) {
    switch (card.type) {
      case "tasks": {
        const items = card.ids.map((id) => Store.findTask(id)).filter(Boolean).map((f) => f.task);
        if (!items.length) return `<div class="card note">${U.icon("info")}<span class="grow">Those tasks have been removed.</span></div>`;
        if (items.length === 1) {
          const t = items[0];
          const when = [U.friendlyDate(t.dueDate), U.friendlyTime(t.dueTime)].filter(Boolean).join(" · ");
          return `<div class="card">
              <div class="card-head"><span class="tick">${U.icon("check")}</span><strong>${U.esc(card.heading || "Task Added")}</strong></div>
              <div class="card-body"><ul class="check-list">${taskLi(t, when)}</ul></div>
              <div class="card-foot"><button class="btn small" data-route="tasks" data-highlight="${t.id}">View Task</button></div>
            </div>`;
        }
        return `<div class="card">
            <div class="card-head"><span class="tick">${U.icon("check")}</span><strong>${U.esc(card.heading)}</strong></div>
            <div class="card-body"><ul class="check-list">${items.map((t) => taskLi(t, [U.friendlyDate(t.dueDate), U.friendlyTime(t.dueTime)].filter(Boolean).join(" · "))).join("")}</ul></div>
            <div class="card-foot"><button class="btn small" data-route="tasks">View Tasks</button></div>
          </div>`;
      }
      case "grocery": {
        const items = card.ids.map((id) => Store.find("grocery", id)).filter(Boolean);
        if (!items.length) return `<div class="card note">${U.icon("cart")}<span class="grow">Those grocery items are gone from your list.</span></div>`;
        return `<div class="card">
            <div class="card-head"><span class="tick">${U.icon("check")}</span><strong>${U.esc(card.heading)}</strong></div>
            <div class="card-body"><ul class="check-list">${items
              .map((g) => `<li class="${g.checked ? "done" : ""}"><label><input type="checkbox" class="check" data-grocery-toggle="${g.id}" ${g.checked ? "checked" : ""}><span class="t"><span>${U.esc(g.name)}</span>${g.quantity ? `<small>${U.esc(g.quantity)}</small>` : ""}</span></label></li>`)
              .join("")}</ul></div>
            <div class="card-foot"><button class="btn small" data-route="grocery">Open Grocery List</button></div>
          </div>`;
      }
      case "recipe": {
        const r = GA.Kitchen.get(card.id);
        if (!r) return `<div class="card note">${U.icon("pot")}<span class="grow">I couldn't make that recipe right now. Let's try again.</span></div>`;
        return GA.RecipeUI.card(r, GA.RecipeUI.openCards.has(r.id));
      }
      case "plan": {
        const items = Store.list("plan").filter((p) => p.date === card.date).sort((a, b) => a.time.localeCompare(b.time));
        return `<div class="card">
            <div class="card-head"><span class="tick">${U.icon("check")}</span><strong>${U.esc(U.friendlyDate(card.date))}'s plan</strong></div>
            <div class="card-body">${items.length ? `<ul class="timeline">${items.map((p) => `<li class="${p.done ? "done" : ""}"><span class="time">${U.friendlyTime(p.time)}</span><span class="dot"></span><span class="what"><span>${U.esc(p.title)}</span></span></li>`).join("")}</ul>` : `<p class="muted">Nothing scheduled for that day anymore.</p>`}</div>
            <div class="card-foot"><button class="btn small" data-route="planner" data-date="${card.date}">Open Planner</button></div>
          </div>`;
      }
      case "memory": {
        const m = Store.find("memory", card.id);
        if (!m) return `<div class="card memory">${U.icon("brain")}<span class="grow muted">Forgotten.</span></div>`;
        return `<div class="card memory">${U.icon("heart")}<span class="grow">Grandma will remember: <strong>${U.esc(m.fact)}</strong></span><button class="btn small ghost" data-memory-forget="${m.id}">Forget</button></div>`;
      }
      case "note":
        return `<div class="card note">${U.icon(card.icon || "check")}<span class="grow">${U.esc(card.text)}</span>${card.link ? `<button class="btn small ghost" data-route="${card.link.route}">${U.esc(card.link.label)}</button>` : ""}</div>`;
      case "upgrade": {
        const plan = GA.Plans.current().name;
        const text =
          card.reason === "memory" ? `Grandma's memory is full on the ${plan} plan.`
          : card.reason === "recipes" ? `The ${plan} plan saves up to ${GA.Plans.limit("savedRecipes")} recipes.`
          : card.reason === "recipeGens" ? `That's all the new recipes for today on the ${plan} plan (${GA.Plans.limit("recipeGens")} a day).`
          : card.reason === "planDays" ? `The ${plan} plan plans ${GA.Plans.limit("planDays")} days ahead. Upgrade for weekly planning.`
          : "That's part of Grandma+.";
        return `<div class="card note">${U.icon("star")}<span class="grow">${U.esc(text)}</span><button class="btn small" data-route="pricing">See plans</button></div>`;
      }
      default:
        return "";
    }
  }

  function taskLi(t, when) {
    return `<li class="${t.completed ? "done" : ""}"><label><input type="checkbox" class="check" data-task-toggle="${t.id}" ${t.completed ? "checked" : ""}><span class="t"><span>${U.esc(t.title)}</span>${when ? `<small>${U.esc(when)}${t.remind ? " · reminder on" : ""}</small>` : ""}</span></label></li>`;
  }

  function cardsHTML(cards, keyPrefix) {
    if (!cards || !cards.length) return "";
    return `<div class="cards">${cards
      .map((c, i) => {
        const key = `${keyPrefix}-${i}`;
        cardRegistry.set(key, c);
        return `<div data-card="${key}">${renderCard(c)}</div>`;
      })
      .join("")}</div>`;
  }

  /* ---------------- thread rendering ---------------- */
  function welcomeHTML() {
    const name = Store.doc("profile").name;
    const { done, total } = todaysProgress();
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="welcome">
        ${U.avatar(76)}
        <p class="hello">${U.esc(U.greetingWord())}${name ? ", " + U.esc(name) : ""} ❤️</p>
        <h2>What can Grandma help you with?</h2>
        <p class="sub">Recipes, chores, planning, groceries, or just a little help getting through the day.</p>
        <p class="grandma-line">${U.esc(grandmaLine())}</p>
        ${total ? `<a class="progress-pill" href="#/tasks" data-route="tasks"><span class="ring" style="--p:${pct}"></span><span>Today's Progress · <b>${done} / ${total}</b> tasks completed</span></a>` : ""}
        <div class="prompt-grid">
          ${PROMPTS.map(([e, t]) => `<button class="prompt-card" data-prompt="${U.esc(t)}"><span class="emo">${e}</span><span>${U.esc(t)}</span></button>`).join("")}
        </div>
      </div>`;
  }

  /* Labs (Grandma Pro): one-tap follow-ups under Grandma's latest answer. */
  function suggestions(m) {
    const types = (m.cards || []).map((c) => c.type);
    if (types.includes("recipe")) return ["Make it quicker", "Something different", "Plan it for dinner tomorrow"];
    if (types.includes("grocery")) return ["Add a few breakfast things", "What can I make with these?"];
    if (types.includes("tasks")) return ["Help me plan my day", "Break it into smaller steps"];
    if (types.includes("plan")) return ["Add a break for lunch", "What's for dinner?"];
    return ["What's for dinner?", "Plan my day", "I need some encouragement"];
  }
  const labsOn = () => GA.Plans.can("labs") && Boolean((Store.doc("settings").labs || {}).suggest);

  function messageHTML(m, i, all) {
    if (m.role === "user") {
      const imgs = (m.images || []).length ? `<div class="imgs">${m.images.map((id) => `<span class="media-frame"><img data-media-id="${id}" alt="Attached photo"></span>`).join("")}</div>` : "";
      return `<div class="msg user"><div class="bubble">${imgs}${U.esc(m.text || "")}</div></div>`;
    }
    if (m.role === "error") {
      return `<div class="msg error">${U.avatar(30)}<div class="body"><p>${U.esc(m.text)}</p><div class="row"><button class="btn small primary" data-retry="${i}">${U.icon("refresh")}Try again</button>${m.setup ? `<button class="btn small ghost" data-brain-setup>Open setup</button>` : ""}</div></div></div>`;
    }
    return `<div class="msg grandma">${U.avatar(30)}<div class="body">
        ${m.text ? `<div class="content">${U.md(m.text)}</div>` : ""}
        ${cardsHTML(m.cards, "m" + i)}
        ${m.text ? `<div class="msg-tools">
          <button class="icon-btn" data-copy="${i}" aria-label="Copy" title="Copy">${U.icon("copy")}</button>
          ${GA.Voice.canSpeak() ? `<button class="icon-btn" data-speak="${i}" aria-label="Read aloud" title="Read aloud">${U.icon("volume")}</button>` : ""}
        </div>` : ""}
        ${all && i === all.length - 1 && labsOn() && !busy ? `<div class="suggest">${suggestions(m).map((t) => `<button class="chip" data-prompt="${U.esc(t)}">${U.esc(t)}</button>`).join("")}</div>` : ""}
      </div></div>`;
  }

  function ephemeralHTML() {
    if (!ephemeral) return "";
    if (ephemeral.kind === "connect") {
      return `<div class="msg notice">${U.avatar(30)}<div class="body">
          <p><strong>Let's get Grandma set up first.</strong></p>
          <p class="muted">Grandma's brain runs right here in your browser — free, private, nothing to install. The first time, your browser downloads her once. Recipes, tasks, groceries, and the planner already work.</p>
          <div class="row"><button class="btn small primary" data-brain-setup>Turn on Grandma</button><button class="btn small ghost" data-route="recipes">Browse recipes</button></div>
        </div></div>`;
    }
    if (ephemeral.kind === "limit") {
      const rewarded = GA.Ads.rewardedAvailable();
      return `<div class="msg notice">${U.avatar(30)}<div class="body">
          <p><strong>That's all the chatting for today on the ${U.esc(GA.Plans.current().name)} plan.</strong></p>
          <p class="muted">Your tasks, recipes, and lists all still work. Come back tomorrow, or upgrade for more daily conversations.</p>
          <div class="row"><button class="btn small primary" data-route="pricing">See plans</button>${rewarded ? `<button class="btn small" data-rewarded>Watch an ad for 5 more</button>` : ""}</div>
        </div></div>`;
    }
    if (ephemeral.kind === "auth") {
      return `<div class="msg notice">${U.avatar(30)}<div class="body">
          <p><strong>Please sign in to keep chatting.</strong></p>
          <p class="muted">This Grandma AI server asks everyone to have a free account. It keeps your conversations and lists safe across devices.</p>
          <div class="row"><button class="btn small primary" data-auth="signup">Create account</button><button class="btn small ghost" data-auth="login">Sign in</button></div>
        </div></div>`;
    }
    return "";
  }

  function render() {
    if (!el.thread) return;
    cardRegistry.clear();
    const conv = currentId ? Store.conv(currentId) : { messages: [] };
    const msgs = conv.messages || [];
    const showPending = pending && pending.convId === currentId;
    let html = "";
    const empty = !msgs.length && !showPending;
    // On a fresh screen, show any notice first so it's never hidden below the fold.
    if (empty) html = ephemeralHTML() + welcomeHTML();
    else html = msgs.map(messageHTML).join("");
    if (showPending) {
      html += `<div class="msg grandma" id="pending-msg">${U.avatar(30, "thinking")}<div class="body">
          ${pending.text ? `<div class="content">${U.md(pending.text)}</div>` : ""}
          ${cardsHTML(pending.cards, "p")}
          <div class="typing" aria-label="Grandma is typing"><i></i><i></i><i></i></div>
        </div></div>`;
    }
    if (!empty) html += ephemeralHTML();
    el.thread.innerHTML = html;
    GA.Account.hydrateImages(el.thread);
    updateStatus();
  }

  /* Re-render only the action cards (keeps scroll and avoids re-animating). */
  function refreshCards() {
    if (!el.thread) return;
    U.$$("[data-card]", el.thread).forEach((node) => {
      const c = cardRegistry.get(node.dataset.card);
      if (c) node.innerHTML = renderCard(c);
    });
  }

  function updateStatus() {
    GA.App && GA.App.updateTopbar();
    el.send.disabled = !busy && !el.input.value.trim() && !attachments.length;
    el.send.innerHTML = busy ? U.icon("stop") : U.icon("send");
    el.send.setAttribute("aria-label", busy ? "Stop" : "Send message");
    el.send.type = busy ? "button" : "submit";
    const remaining = GA.Plans.remainingMessages();
    el.hint.textContent = GA.AI.connected() && remaining <= 5 ? `${remaining} message${remaining === 1 ? "" : "s"} left today` : "";
  }

  /* ---------------- sending ---------------- */
  async function resolveImages(messages) {
    const out = [];
    for (const m of messages) {
      if (m.role !== "user" || !Array.isArray(m.content) || !m.content.some((b) => b.type === "image_ref")) {
        out.push(m);
        continue;
      }
      const content = [];
      for (const b of m.content) {
        if (b.type !== "image_ref") {
          content.push(b);
          continue;
        }
        const blob = await Store.DB.getMedia(b.media_id).catch(() => null);
        if (blob) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await U.blobToBase64(blob) } });
        else content.push({ type: "text", text: "[A photo that's no longer available.]" });
      }
      out.push({ ...m, content });
    }
    return out;
  }

  function ensureConversation(title) {
    const conv = Store.add("conversations", { title, lastAt: Date.now() });
    Store.saveConv(conv.id, { messages: [], api: [] });
    return conv.id;
  }

  function preflight() {
    if (!GA.AI.connected()) return "connect";
    if (GA.Plans.remainingMessages() <= 0) return "limit";
    return null;
  }

  /*
   * Core pipeline used by the chat and cooking mode.
   * Returns Grandma's reply text, or null on failure.
   */
  async function run(convId, text, imageIds, extra = {}, { visible = true } = {}) {
    const conv = Store.conv(convId);
    const messages = (conv.messages || []).slice();
    const api = (conv.api || []).slice();
    messages.push({ role: "user", text, images: imageIds, ts: Date.now() });
    Store.saveConv(convId, { messages, api });
    Store.update("conversations", convId, { lastAt: Date.now() });

    busy = true;
    pending = { convId, text: "", cards: [] };
    abort = new AbortController();
    if (visible && convId === currentId) {
      render();
      toBottom(true);
    } else updateStatus();

    const userContent = [];
    imageIds.forEach((id) => userContent.push({ type: "image_ref", media_id: id }));
    if (text) userContent.push({ type: "text", text });

    const convRecipes = Store.list("recipes").filter((r) => r.convId === convId).map((r) => ({ id: r.id, name: r.name, servings: r.servings }));
    let reply = null;
    try {
      const res = await GA.AI.runTurn({
        api,
        userContent: userContent.length === 1 && userContent[0].type === "text" ? text : userContent,
        extra: { ...extra, convId, convRecipes },
        signal: abort.signal,
        resolveImages,
        onProgress(t, cards) {
          pending.text = t;
          pending.cards = cards.slice();
          if (visible && convId === currentId) {
            const stick = nearBottom();
            render();
            if (stick) toBottom();
          }
        },
      });
      GA.Plans.recordMessage();
      messages.push({ role: "grandma", text: res.text, cards: res.cards, ts: Date.now() });
      reply = res.text;
    } catch (e) {
      if (e.name === "AbortError") {
        messages.pop();
        if (visible) {
          el.input.value = text;
          autosize();
        }
      } else if (e.kind === "limit") {
        messages.pop();
        ephemeral = { kind: "limit" };
      } else if (e.kind === "auth") {
        messages.pop();
        ephemeral = { kind: "auth" };
        if (visible) {
          el.input.value = text;
          autosize();
        }
      } else if (e.kind === "config") {
        messages.pop();
        ephemeral = { kind: "connect" };
      } else {
        console.warn("AI error", e);
        if (e.cards && e.cards.length) messages.push({ role: "grandma", text: "", cards: e.cards, ts: Date.now() });
        messages.push({
          role: "error",
          text:
            e.kind === "offline" ? "Looks like you're offline. I'll be right here when you're back."
            : e.kind === "brain-unsupported" ? "This browser can't run my brain. Chrome or Edge work best."
            : e.kind === "brain-load" ? "I couldn't wake up just now. Let's try turning me on again."
            : e.kind === "brain" ? "I got a little muddled there. Let's try that again."
            : "Grandma's having trouble connecting right now. Give it another try in a moment.",
          setup: /^brain-(load|unsupported)/.test(e.kind || ""),
          retry: { text, images: imageIds },
          ts: Date.now(),
        });
      }
    } finally {
      busy = false;
      pending = null;
      abort = null;
    }
    Store.saveConv(convId, { messages, api });
    if (!messages.length) {
      // Nothing left in a brand-new conversation: don't keep an empty entry.
      Store.deleteConv(convId);
      if (currentId === convId) currentId = null;
    }
    if (visible && (convId === currentId || !currentId)) {
      render();
      toBottom(true);
    } else updateStatus();

    if (reply && visible) maybeSpeak(reply);
    return reply;
  }

  function maybeSpeak(text) {
    const v = Store.doc("settings").voice;
    const allowed = GA.Plans.can("voiceReplies");
    if (!(v.replies && allowed && GA.Voice.canSpeak())) {
      lastInputVoice = false;
      return;
    }
    GA.Voice.speak(text, {
      onEnd: () => {
        // Hands-free conversation: keep listening after Grandma answers a spoken question.
        // (A Grandma Pro perk; it can be turned off in Settings → Voice.)
        if (lastInputVoice && GA.Plans.can("handsFree") && v.handsFree !== false && GA.App.currentRoute() === "chat" && !busy) startListening();
      },
    });
  }

  async function send(textIn, { voice = false } = {}) {
    const text = (textIn != null ? textIn : el.input.value).trim();
    const imageIds = attachments.map((a) => a.id);
    if ((!text && !imageIds.length) || busy) return;
    lastInputVoice = voice;
    ephemeral = null;
    const problem = preflight();
    if (problem) {
      ephemeral = { kind: problem };
      el.input.value = text; // keep what they wrote
      autosize();
      render();
      if (currentId && (Store.conv(currentId).messages || []).length) toBottom(true);
      else el.scroll.scrollTop = 0;
      return;
    }
    el.input.value = "";
    autosize();
    attachments = [];
    renderAttachments();
    if (!currentId) {
      currentId = ensureConversation(titleFrom(text || "Photo from you"));
      GA.App.setRoute("chat/" + currentId, { replace: true, silent: true });
    }
    await run(currentId, text, imageIds);
  }

  /* ---------------- composer ---------------- */
  function autosize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
    updateStatus();
  }

  function renderAttachments() {
    el.preview.hidden = !attachments.length;
    el.preview.innerHTML = attachments
      .map((a, i) => `<div class="thumb"><img src="${a.url}" alt="Attached photo ${i + 1}"><button type="button" data-remove-attach="${i}" aria-label="Remove photo">${U.icon("x")}</button></div>`)
      .join("");
    updateStatus();
  }

  async function addFiles(files) {
    for (const f of Array.from(files).slice(0, 4 - attachments.length)) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const blob = await U.resizeImage(f, 1568, 0.85);
        const id = U.uid("m_");
        await Store.DB.putMedia(id, blob);
        attachments.push({ id, url: URL.createObjectURL(blob), blob });
      } catch (e) {
        U.toast("I couldn't read that photo.");
      }
    }
    renderAttachments();
  }

  function startListening() {
    if (!GA.Voice.canListen()) {
      U.toast("Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    if (!Store.doc("settings").voice.input) {
      U.toast("Voice input is turned off in Settings.");
      return;
    }
    el.mic.classList.add("listening");
    el.hint.textContent = "Listening…";
    const before = el.input.value;
    stopListening = GA.Voice.listen({
      onInterim: (t) => {
        el.input.value = (before ? before + " " : "") + t;
        autosize();
      },
      onFinal: (t) => {
        const full = ((before ? before + " " : "") + t).trim();
        el.input.value = full;
        send(full, { voice: true });
      },
      onEnd: () => {
        el.mic.classList.remove("listening");
        stopListening = null;
        updateStatus();
      },
      onError: (e) => {
        if (e && (e.error === "not-allowed" || e.error === "service-not-allowed")) U.toast("Please allow microphone access to talk to Grandma.");
        else if (e && e.error === "no-speech") U.toast("I didn't catch that. Try again?");
      },
    });
  }

  function mount() {
    el.thread = U.$("#chat-thread");
    el.scroll = U.$("#chat-scroll");
    el.input = U.$("#composer-input");
    el.form = U.$("#composer");
    el.send = U.$("#send-btn");
    el.mic = U.$("#mic-btn");
    el.attach = U.$("#attach-btn");
    el.file = U.$("#attach-input");
    el.preview = U.$("#attach-preview");
    el.hint = U.$("#composer-hint");

    el.attach.innerHTML = U.icon("clip");
    el.mic.innerHTML = U.icon("mic");
    el.send.innerHTML = U.icon("send");

    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      send();
    });
    el.send.addEventListener("click", (e) => {
      if (busy) {
        e.preventDefault();
        abort && abort.abort();
      }
    });
    el.input.addEventListener("input", autosize);
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    el.input.addEventListener("paste", (e) => {
      const files = Array.from(e.clipboardData ? e.clipboardData.files : []);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
    el.attach.addEventListener("click", () => el.file.click());
    el.file.addEventListener("change", () => {
      addFiles(el.file.files);
      el.file.value = "";
    });
    el.mic.addEventListener("click", () => {
      if (stopListening) {
        stopListening();
        lastInputVoice = false;
        return;
      }
      GA.Voice.stopSpeaking();
      startListening();
    });
    el.mic.hidden = !GA.Voice.canListen();

    el.preview.addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-attach]");
      if (!b) return;
      const [a] = attachments.splice(Number(b.dataset.removeAttach), 1);
      if (a) Store.DB.delMedia(a.id).catch(() => {});
      renderAttachments();
    });

    el.scroll.addEventListener("scroll", () => U.$("#topbar").classList.toggle("scrolled", el.scroll.scrollTop > 4), { passive: true });

    el.thread.addEventListener("click", async (e) => {
      const p = e.target.closest("[data-prompt]");
      if (p) return send(p.dataset.prompt);
      const r = e.target.closest("[data-retry]");
      if (r) return retry(Number(r.dataset.retry));
      const c = e.target.closest("[data-copy]");
      if (c) {
        const m = Store.conv(currentId).messages[Number(c.dataset.copy)];
        try {
          await navigator.clipboard.writeText(m.text);
          U.toast("Copied");
        } catch (err) { /* ignore */ }
        return;
      }
      const s = e.target.closest("[data-speak]");
      if (s) {
        const m = Store.conv(currentId).messages[Number(s.dataset.speak)];
        if (GA.Voice.speaking()) GA.Voice.stopSpeaking();
        else GA.Voice.speak(m.text);
        return;
      }
      if (e.target.closest("[data-rewarded]")) {
        const ok = await GA.Ads.showRewarded();
        if (ok) {
          ephemeral = null;
          render();
        }
      }
    });

    // Live-update cards when the underlying data changes anywhere in the app.
    ["tasks", "htasks", "grocery", "recipes", "plan", "memory"].forEach((k) => Store.on(k, () => GA.App.currentRoute() === "chat" && refreshCards()));
    Store.on("conv:*", (key) => {
      if (key === "conv:" + currentId && !busy && GA.App.currentRoute() === "chat") render();
    });
  }

  async function retry(index) {
    const conv = Store.conv(currentId);
    const m = conv.messages[index];
    if (!m || !m.retry || busy) return;
    const messages = conv.messages.slice();
    messages.splice(index, 1);
    // Remove the failed user message too; run() adds it back.
    const prev = messages[index - 1];
    if (prev && prev.role === "user") messages.splice(index - 1, 1);
    Store.saveConv(currentId, { ...conv, messages });
    await run(currentId, m.retry.text, m.retry.images || []);
  }

  /* ---------------- public API ---------------- */
  const Chat = {
    mount,
    render,
    busy: () => busy,
    currentId: () => currentId,
    open(id) {
      const exists = id && Store.find("conversations", id);
      const changed = currentId !== (exists ? id : null);
      currentId = exists ? id : null;
      if (changed) ephemeral = null;
      render();
      requestAnimationFrame(() => toBottom());
    },
    newChat() {
      currentId = null;
      ephemeral = null;
      render();
      if (window.matchMedia("(pointer: fine)").matches) el.input.focus();
    },
    send,
    focus: () => el.input && el.input.focus(),
    prefill(text) {
      el.input.value = text;
      autosize();
      el.input.focus();
    },
    /* Used by cooking mode: ask in a per-recipe conversation without leaving the screen. */
    async ask(q, { cooking, title }) {
      const problem = preflight();
      if (problem === "connect") return "Grandma isn't connected to her AI yet, so I can't answer questions here. Your recipe and timers still work!";
      if (problem === "limit") return "That's all the chatting for today on your plan — but you're doing great. Trust your eyes and nose.";
      if (busy) return "One second — I'm still answering something else.";
      let conv = Store.list("conversations").find((c) => c.title === title);
      const convId = conv ? conv.id : ensureConversation(title);
      return run(convId, q, [], { cooking }, { visible: false });
    },
    catEmoji: CAT_EMOJI,
  };

  GA.Chat = Chat;
})();
