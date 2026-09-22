/*
 * Grandma AI — recipe rendering shared by chat cards and the Recipes page,
 * plus the full-screen "Start Cooking" mode.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const TILE = {
    Breakfast: "#f8e1b8", Dinner: "#f3cfc0", Desserts: "#f5d3dc", Baking: "#efdcc4", "Comfort Food": "#f1d6c2",
    Southern: "#f0dcb4", Italian: "#e3e8c6", Mexican: "#f6d2b4", "American Classics": "#dde3ef",
  };
  const tileColor = (r) => TILE[(r.categories || [])[0]] || "#f3d7c8";
  const totalTime = (r) => (r.prepMinutes || 0) + (r.cookMinutes || 0);
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`);

  function meta(r) {
    const bits = [];
    if (totalTime(r)) bits.push(`<span>${U.icon("clock")}${fmtMin(totalTime(r))}</span>`);
    bits.push(`<span>${U.icon("users")}${r.servings} serving${r.servings === 1 ? "" : "s"}</span>`);
    if (r.difficulty) bits.push(`<span>${U.icon("flame")}${U.esc(r.difficulty)}</span>`);
    return `<div class="meta">${bits.join("")}</div>`;
  }

  function actions(r) {
    const saved = GA.Kitchen.isSaved(r.id);
    return `
      <button class="btn small primary" data-recipe-action="cook" data-id="${r.id}">${U.icon("pot")}Start Cooking</button>
      <button class="btn small ${saved ? "saved" : ""}" data-recipe-action="save" data-id="${r.id}" aria-pressed="${saved}">${U.icon("bookmark")}${saved ? "Saved" : "Save Recipe"}</button>
      <button class="btn small" data-recipe-action="grocery" data-id="${r.id}">${U.icon("cart")}Add to Grocery List</button>
      <span class="scale-btns" role="group" aria-label="Scale recipe">
        <button class="btn small ghost" data-recipe-action="halve" data-id="${r.id}">½ Halve</button>
        <button class="btn small ghost" data-recipe-action="double" data-id="${r.id}">2× Double</button>
      </span>`;
  }

  function full(r) {
    const f = GA.Kitchen.factor(r);
    const ings = r.ingredients
      .map((i) => `<li><span class="q">${U.esc(GA.Kitchen.qtyText(i, f)) || "—"}</span><span>${U.esc(i.item)}</span></li>`)
      .join("");
    const steps = r.steps.map((s) => `<li><span>${U.esc(s)}</span></li>`).join("");
    const tips = (r.tips || []).map((t) => `<div class="tip"><b>Grandma's Tip ❤️</b>${U.esc(t)}</div>`).join("");
    const scaled = r.servings !== r.baseServings ? ` <small class="muted" style="text-transform:none;letter-spacing:0">(${r.servings > r.baseServings ? "scaled up" : "scaled down"} from ${r.baseServings})</small>` : "";
    return `
      <div class="recipe-full">
        <h4><span>Ingredients${scaled}</span>
          <span class="stepper" aria-label="Servings">
            <button data-recipe-action="dec" data-id="${r.id}" aria-label="Fewer servings">−</button>
            <span>${r.servings} serving${r.servings === 1 ? "" : "s"}</span>
            <button data-recipe-action="inc" data-id="${r.id}" aria-label="More servings">+</button>
          </span>
        </h4>
        <ul class="ing-list">${ings}</ul>
        <h4>Instructions</h4>
        <ol class="step-list">${steps}</ol>
        ${tips}
      </div>`;
  }

  /* Chat card: summary + collapsible detail. */
  function card(r, open) {
    return `
      <div class="card recipe-card ${open ? "open" : ""}" data-recipe-card="${r.id}">
        <div class="rc-top">
          <div class="food-tile" style="--tile:${tileColor(r)}" role="img" aria-label="${U.esc(r.name)}">${U.esc(r.emoji || "🍲")}</div>
          <div class="grow">
            <div class="kicker muted" style="font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.06em">Recipe</div>
            <h3>${U.esc(r.name)}</h3>
            ${r.description ? `<p>${U.esc(r.description)}</p>` : ""}
            ${meta(r)}
          </div>
        </div>
        <div class="rc-actions">${actions(r)}</div>
        <div class="rc-detail"><div>${full(r)}</div></div>
        <button class="rc-expand" data-recipe-action="toggle" data-id="${r.id}" aria-expanded="${open ? "true" : "false"}">
          <span>${open ? "Hide recipe" : "Show full recipe"}</span>${U.icon("chevronDown")}
        </button>
      </div>`;
  }

  const openCards = new Set();

  async function handle(action, id, el) {
    const r = GA.Kitchen.get(id);
    if (!r) return U.toast("I couldn't find that recipe.");
    switch (action) {
      case "toggle": {
        const c = el.closest(".recipe-card");
        const open = !c.classList.contains("open");
        c.classList.toggle("open", open);
        open ? openCards.add(id) : openCards.delete(id);
        el.setAttribute("aria-expanded", String(open));
        el.querySelector("span").textContent = open ? "Hide recipe" : "Show full recipe";
        break;
      }
      case "save": {
        const saved = GA.Kitchen.isSaved(id);
        const res = GA.Kitchen.save(id, !saved);
        if (res.error && res.error.startsWith("limit")) {
          U.toast(`The Free plan saves up to ${GA.Plans.limit("savedRecipes")} recipes.`, { action: { label: "See plans", run: () => GA.App.go("pricing") } });
        } else U.toast(saved ? "Removed from your recipes" : "Saved to your recipes ❤️");
        break;
      }
      case "double":
        GA.Kitchen.setServings(id, r.servings * 2);
        openCards.add(id);
        break;
      case "halve":
        GA.Kitchen.setServings(id, Math.max(1, Math.round(r.servings / 2)));
        openCards.add(id);
        break;
      case "inc":
        GA.Kitchen.setServings(id, r.servings + 1);
        openCards.add(id);
        break;
      case "dec":
        if (r.servings > 1) GA.Kitchen.setServings(id, r.servings - 1);
        openCards.add(id);
        break;
      case "grocery": {
        const made = GA.Kitchen.addToGrocery(id);
        U.toast(`Added ${made.length} item${made.length === 1 ? "" : "s"} to your grocery list`, { action: { label: "View", run: () => GA.App.go("grocery") } });
        break;
      }
      case "cook":
        Cook.open(id);
        break;
    }
  }

  /* ---------------- cooking mode ---------------- */
  const Cook = {
    state: null,
    lock: null,

    open(id) {
      const r = GA.Kitchen.get(id);
      if (!r) return;
      Cook.close(true);
      Cook.state = { id, step: 0, timers: [], answer: "", asking: false };
      const host = U.$("#cook-host");
      host.innerHTML = `<div class="cook" role="dialog" aria-modal="true" aria-label="Cooking ${U.esc(r.name)}"></div>`;
      Cook.render();
      Cook.keepAwake();
      document.addEventListener("keydown", Cook.onKey);
    },

    onKey(e) {
      if (!Cook.state || e.target.matches("input, textarea")) return;
      if (e.key === "ArrowRight") Cook.go(1);
      else if (e.key === "ArrowLeft") Cook.go(-1);
      else if (e.key === "Escape") Cook.close();
    },

    async keepAwake() {
      try {
        if ("wakeLock" in navigator) Cook.lock = await navigator.wakeLock.request("screen");
      } catch (e) { /* not allowed */ }
    },

    close(silent) {
      if (!Cook.state) return;
      Cook.state.timers.forEach((t) => clearInterval(t.iv));
      Cook.state = null;
      if (Cook.lock) Cook.lock.release().catch(() => {});
      Cook.lock = null;
      document.removeEventListener("keydown", Cook.onKey);
      GA.Voice.stopSpeaking();
      U.$("#cook-host").innerHTML = "";
      if (!silent) U.toast("Hope it turned out delicious ❤️");
    },

    go(d) {
      const s = Cook.state;
      const r = GA.Kitchen.get(s.id);
      const next = s.step + d;
      if (next < 0) return;
      if (next >= r.steps.length) {
        Cook.close();
        return;
      }
      s.step = next;
      s.answer = "";
      Cook.render();
    },

    timersIn(text) {
      const out = [];
      const re = /(\d+)(?:\s*(?:–|-|to)\s*(\d+))?\s*(minutes?|mins?|hours?|hrs?)\b/gi;
      let m;
      while ((m = re.exec(text))) {
        const n = Number(m[1]);
        const unit = /h/i.test(m[3]) ? 60 : 1;
        if (n > 0 && n * unit <= 600) out.push({ minutes: n * unit, label: `${m[1]}${m[2] ? "–" + m[2] : ""} ${unit === 60 ? "hr" : "min"}` });
      }
      return out.slice(0, 2);
    },

    startTimer(minutes, label) {
      const s = Cook.state;
      const t = { label, left: minutes * 60, iv: null, done: false };
      t.iv = setInterval(() => {
        t.left--;
        if (t.left <= 0) {
          clearInterval(t.iv);
          t.done = true;
          t.left = 0;
          try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { /* ignore */ }
          GA.Voice.speak(`Your ${label} timer is done.`);
          U.toast(`⏰ ${label} timer is done!`, { ms: 8000 });
        }
        Cook.renderTimers();
      }, 1000);
      s.timers.push(t);
      Cook.renderTimers();
    },

    renderTimers() {
      const el = U.$("#cook-timer-list");
      if (!el || !Cook.state) return;
      el.innerHTML = Cook.state.timers
        .map((t, i) => {
          const mm = Math.floor(t.left / 60), ss = String(t.left % 60).padStart(2, "0");
          return `<button class="timer-chip ${t.done ? "done" : "running"}" data-cook="timer-dismiss" data-i="${i}" title="${t.done ? "Dismiss" : "Cancel timer"}">${U.icon("timer")}${t.done ? "Done!" : `${mm}:${ss}`} · ${U.esc(t.label)}</button>`;
        })
        .join("");
    },

    render() {
      const s = Cook.state;
      const r = GA.Kitchen.get(s.id);
      const el = U.$("#cook-host .cook");
      if (!el || !r) return;
      const text = r.steps[s.step];
      const pct = Math.round(((s.step + 1) / r.steps.length) * 100);
      const suggestions = Cook.timersIn(text);
      el.innerHTML = `
        <div class="cook-top">
          <button class="icon-btn" data-cook="close" aria-label="Exit cooking mode">${U.icon("x")}</button>
          <h3>${U.esc(r.emoji || "")} ${U.esc(r.name)}</h3>
          <button class="btn small ghost" data-cook="ings">Ingredients</button>
          ${GA.Voice.canSpeak() ? `<button class="icon-btn" data-cook="read" aria-label="Read this step aloud">${U.icon("volume")}</button>` : ""}
        </div>
        <div class="cook-progress"><i style="width:${pct}%"></i></div>
        <div class="cook-main">
          <div class="cook-step-num">Step ${s.step + 1} of ${r.steps.length}</div>
          <div class="cook-step">${U.esc(text)}</div>
          <div class="cook-timers">
            ${suggestions.map((t) => `<button class="timer-chip" data-cook="timer" data-min="${t.minutes}" data-label="${U.esc(t.label)}">${U.icon("timer")}Start ${U.esc(t.label)} timer</button>`).join("")}
          </div>
          <div class="cook-timers" id="cook-timer-list"></div>
          ${s.step === 0 && r.tips && r.tips[0] ? `<div class="tip"><b>Grandma's Tip ❤️</b>${U.esc(r.tips[0])}</div>` : ""}
          <div id="cook-answer">${Cook.answerHTML()}</div>
        </div>
        <form class="cook-ask" data-cook-form>
          <input class="input grow" name="q" placeholder="Ask Grandma — “my sauce is too thick”" autocomplete="off" aria-label="Ask Grandma a cooking question">
          ${GA.Voice.canListen() ? `<button type="button" class="icon-btn" data-cook="mic" aria-label="Ask by voice">${U.icon("mic")}</button>` : ""}
          <button class="send-btn" aria-label="Ask">${U.icon("send")}</button>
        </form>
        <div class="cook-nav">
          <button class="btn" data-cook="prev" ${s.step === 0 ? "disabled" : ""}>${U.icon("chevronLeft")}Back</button>
          <button class="btn primary" data-cook="next">${s.step === r.steps.length - 1 ? "Finish" : "Next step"}${s.step === r.steps.length - 1 ? "" : U.icon("chevronRight")}</button>
        </div>`;
      Cook.renderTimers();
      el.onclick = Cook.onClick;
      el.querySelector("[data-cook-form]").onsubmit = (e) => {
        e.preventDefault();
        const q = e.target.q.value.trim();
        if (q) {
          e.target.q.value = "";
          Cook.ask(q);
        }
      };
    },

    answerHTML() {
      const s = Cook.state;
      if (s.asking) return `<div class="cook-answer">${U.avatar(28, "thinking")}<div class="content"><div class="typing"><i></i><i></i><i></i></div></div></div>`;
      if (s.answer) return `<div class="cook-answer">${U.avatar(28)}<div class="content">${U.md(s.answer)}</div></div>`;
      return "";
    },

    async ask(q) {
      const s = Cook.state;
      const r = GA.Kitchen.get(s.id);
      s.asking = true;
      U.$("#cook-answer").innerHTML = Cook.answerHTML();
      const cooking = { name: r.name, servings: r.servings, step: s.step + 1, total: r.steps.length, stepText: r.steps[s.step] };
      const reply = await GA.Chat.ask(q, { cooking, title: `Cooking: ${r.name}` });
      if (!Cook.state) return;
      s.asking = false;
      s.answer = reply || "Grandma's having trouble connecting right now. Give it another try in a moment.";
      U.$("#cook-answer").innerHTML = Cook.answerHTML();
      if (reply && Store.doc("settings").voice.replies && GA.Plans.current().voiceReplies) GA.Voice.speak(reply);
    },

    onClick(e) {
      const b = e.target.closest("[data-cook]");
      if (!b) return;
      const s = Cook.state;
      const r = GA.Kitchen.get(s.id);
      switch (b.dataset.cook) {
        case "close": Cook.close(true); break;
        case "prev": Cook.go(-1); break;
        case "next": Cook.go(1); break;
        case "read": GA.Voice.speak(r.steps[s.step]); break;
        case "timer": Cook.startTimer(Number(b.dataset.min), b.dataset.label); break;
        case "timer-dismiss": {
          const t = s.timers[Number(b.dataset.i)];
          if (t) clearInterval(t.iv);
          s.timers.splice(Number(b.dataset.i), 1);
          Cook.renderTimers();
          break;
        }
        case "mic":
          b.classList.add("active");
          GA.Voice.listen({ onFinal: (t) => Cook.ask(t), onEnd: () => b.classList.remove("active"), onError: () => U.toast("I couldn't hear that. Try typing instead.") });
          break;
        case "ings": {
          const f = GA.Kitchen.factor(r);
          U.openSheet({
            title: `Ingredients · ${r.servings} servings`,
            body: `<ul class="cook-ings">${r.ingredients.map((i) => `<li><label class="row grow"><input type="checkbox" class="check"><span><b>${U.esc(GA.Kitchen.qtyText(i, f))}</b> ${U.esc(i.item)}</span></label></li>`).join("")}</ul>`,
          });
          break;
        }
      }
    },
  };

  GA.RecipeUI = { card, full, actions, meta, tileColor, totalTime, fmtMin, handle, openCards, Cook };
})();
