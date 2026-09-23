/* Grandma AI — Daily planner: a clean timeline Grandma can build and rearrange. */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  let date = null;

  const itemsFor = (d) => Store.list("plan").filter((p) => p.date === d).sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);

  function render(root) {
    date = date || U.today();
    const today = U.today();
    const items = itemsFor(date);
    const now = U.nowTime();
    let nowId = null;
    if (date === today) items.forEach((p) => { if (p.time <= now) nowId = p.id; });
    const tasks = Store.allTasks().filter((t) => t.dueDate === date || (date === today && t.dueDate && t.dueDate < today && !t.completed));
    const d = U.parseKey(date);
    const label = U.friendlyDate(date);

    root.innerHTML = `
      <div class="page-inner">
        <div class="page-head">
          <div><h2>${date === today ? "Today" : U.esc(label)}</h2><p>${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p></div>
          <div class="row wrap">
            <button class="btn primary" data-plan-ai>${U.icon("sparkle")}Plan My Day With Grandma</button>
            <button class="btn ghost" data-meal-plan>🍽️ Plan the week's dinners${GA.Plans.can("mealPlan") ? "" : ` <span class="tag-pro">Grandma+</span>`}</button>
            <button class="btn ghost" data-week-plan>${U.icon("calendar")}Plan my whole week${GA.Plans.can("weekPlan") ? "" : ` <span class="tag-pro">Pro</span>`}</button>
          </div>
        </div>
        <div class="day-nav">
          <button class="icon-btn" data-day="-1" aria-label="Previous day">${U.icon("chevronLeft")}</button>
          <h3>${U.esc(d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}${date !== today ? `<small><button class="link-btn" data-day="today">Back to today</button></small>` : ""}</h3>
          <button class="icon-btn" data-day="1" aria-label="Next day">${U.icon("chevronRight")}</button>
        </div>
        ${items.length ? `<div class="card planner-card"><ul class="timeline">${items
          .map((p) => `<li class="${p.done ? "done" : ""} ${p.id === nowId ? "now" : ""}" data-plan-edit="${p.id}">
                <span class="time">${U.friendlyTime(p.time)}</span><span class="dot"></span>
                <span class="what"><span>${U.esc(p.title)}</span>${p.recipeId ? `<small><button class="link-btn" data-route="recipes/${p.recipeId}">View recipe</button></small>` : ""}${p.durationMin ? `<small>${p.durationMin >= 60 ? Math.round((p.durationMin / 60) * 10) / 10 + " hr" : p.durationMin + " min"}</small>` : ""}</span>
                <input type="checkbox" class="check" data-plan-done="${p.id}" ${p.done ? "checked" : ""} aria-label="Done: ${U.esc(p.title)}">
              </li>`).join("")}</ul></div>`
          : `<div class="empty">${U.avatar(56)}<p>${date === today ? "Nothing planned yet. Want Grandma to sketch out your day?" : "Nothing planned for this day yet."}</p></div>`}
        <form class="add-row" id="plan-add" style="margin-top:14px">
          <input class="input" type="time" name="time" value="${nextSlot(items)}" style="width:128px;border-radius:999px" aria-label="Time" required>
          <input class="input grow" name="title" placeholder="Add to the plan…" aria-label="What" autocomplete="off" maxlength="120" required>
          <button class="btn primary" aria-label="Add to plan">${U.icon("plus")}</button>
        </form>
        ${tasks.length ? `<div class="section-title">Tasks due ${date === today ? "today" : "this day"}</div>
          <div class="list-card">${tasks.map((t) => `<div class="item-row ${t.completed ? "done" : ""}"><input type="checkbox" class="check" data-task-toggle="${t.id}" ${t.completed ? "checked" : ""} aria-label="${U.esc(t.title)}"><div class="t" data-route="tasks/${t.id}"><span>${U.esc(t.title)}</span>${t.dueTime ? `<small>${U.friendlyTime(t.dueTime)}</small>` : ""}</div></div>`).join("")}</div>` : ""}
        <div class="ad-slot" data-ad="planner"></div>
      </div>`;

    U.$("#plan-add", root).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      if (!U.isValidTime(f.time.value) || !f.title.value.trim()) return;
      Store.add("plan", { date, time: f.time.value, title: f.title.value.trim(), durationMin: 0, done: false });
    };
    root.onclick = (e) => {
      const day = e.target.closest("[data-day]");
      if (day) {
        date = day.dataset.day === "today" ? U.today() : U.addDays(date, Number(day.dataset.day));
        return render(root);
      }
      if (e.target.closest("[data-plan-ai]")) {
        const when = date === U.today() ? "today" : U.parseKey(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + ` (${date})`;
        GA.App.askGrandma(itemsFor(date).length ? `Can you help me rearrange my plan for ${when}?` : `Plan my day for ${when}.`);
        return;
      }
      if (e.target.closest("[data-meal-plan]")) {
        if (!GA.Plans.gate("mealPlan", "Weekly meal planning")) return;
        const offerList = () => U.toast("Your week of dinners is planned ❤️", { ms: 6000, action: { label: "Make grocery list", run: () => { const n = GA.Planner.groceryFromPlan(); U.toast(`Added ${n} items to your grocery list`); } } });
        const res = mealPlan(7, offerList);
        if (!res.planned && !res.writing) return U.toast("I couldn't find dinners that fit your preferences. Turn on Grandma's AI or save a few recipes first.");
        if (!res.writing) offerList();
        return render(root);
      }
      if (e.target.closest("[data-week-plan]")) {
        if (!GA.Plans.gate("weekPlan", "Whole-week planning")) return;
        GA.App.askGrandma(`Plan my whole week, starting today (${U.today()}). Use plan_day once for each of the next 7 days with a simple, realistic schedule: meals, chores spread across the week, and some rest. Keep what's already planned.`);
        return;
      }
      if (e.target.closest("[data-plan-done]")) return;
      const ed = e.target.closest("[data-plan-edit]");
      if (ed) edit(ed.dataset.planEdit);
    };
    root.onchange = (e) => {
      const cb = e.target.closest("[data-plan-done]");
      if (cb) Store.update("plan", cb.dataset.planDone, { done: cb.checked });
    };
    GA.Ads.banner(U.$("[data-ad]", root), "planner");
  }

  /*
   * Grandma+ meal planning: seven dinners picked from saved recipes and
   * Grandma's classics, respecting allergies, dislikes, and diet, with no
   * repeats. Each is linked to its recipe so the grocery list can be built.
   */
  const MEAT = /\b(beef|chicken|pork|turkey|sausage|bacon|ham|steak|lamb|shrimp|fish|salmon|tuna|meat|brisket|chorizo)\b/i;
  const DINNER = ["Dinner", "Comfort Food", "Italian", "Mexican"];
  const NOT_DINNER = ["Desserts", "Breakfast", "Baking"];

  function mealRules() {
    const c = Store.doc("settings").cooking || {};
    const avoid = [c.allergies, c.avoid].join(",").toLowerCase().split(/[,;]+/).map((w) => w.trim()).filter((w) => w.length > 2);
    Store.list("memory").filter((m) => m.category === "dislikes").forEach((m) => {
      const w = m.fact.toLowerCase().replace(/^(doesn'?t|does not|don'?t) (like|eat)\s+/, "").replace(/[.]/g, "").trim();
      if (w.length > 2) avoid.push(w.replace(/s$/, ""));
    });
    return { avoid, veg: /vegetarian|vegan/i.test(c.diet || ""), diet: c.diet || "" };
  }

  function fits(r, rules) {
    const cats = r.categories || [];
    const isDinner = cats.some((x) => DINNER.includes(x)) && !(cats.some((x) => NOT_DINNER.includes(x)) && !cats.includes("Dinner"));
    if (!isDinner && !(r.source === "ai" && GA.Kitchen.isSaved(r.id))) return false;
    if (r.ingredients.some((i) => rules.avoid.some((w) => i.item.toLowerCase().includes(w)))) return false;
    if (rules.veg && r.ingredients.some((i) => i.section === "meat" || MEAT.test(i.item))) return false;
    return true;
  }

  function planDinner(day, r) {
    Store.list("plan").filter((p) => p.date === day && p.mealPlan).forEach((p) => Store.remove("plan", p.id));
    Store.add("plan", { date: day, time: "18:00", title: `Dinner: ${r.name}`, durationMin: (r.prepMinutes || 0) + (r.cookMinutes || 0), recipeId: r.id, mealPlan: true, done: false });
  }

  /*
   * Grandma+ meal planning: a week of different dinners from saved recipes and
   * Grandma's classics that fit allergies, dislikes, and diet. If there aren't
   * enough, Grandma writes new ones (when her AI is on).
   */
  function mealPlan(days, onDone) {
    const rules = mealRules();
    const pool = GA.Kitchen.all().filter((r) => fits(r, rules));
    const saved = pool.filter((r) => GA.Kitchen.isSaved(r.id)).sort(() => Math.random() - 0.5);
    const picks = saved.concat(pool.filter((r) => !GA.Kitchen.isSaved(r.id)).sort(() => Math.random() - 0.5)).slice(0, days);
    picks.forEach((r, i) => planDinner(U.addDays(U.today(), i), r));
    const missing = days - picks.length;
    if (missing > 0 && GA.AI.connected()) {
      fillWithNewRecipes(picks.length, missing, rules, picks.map((r) => r.name)).then(onDone);
      return { planned: picks.length, writing: missing };
    }
    if (missing > 0 && picks.length) {
      // No AI: repeat favorites, but never on back-to-back nights.
      for (let i = picks.length; i < days; i++) planDinner(U.addDays(U.today(), i), picks[(i + 1) % picks.length]);
    }
    return { planned: picks.length ? days : 0, writing: 0 };
  }

  async function fillWithNewRecipes(start, count, rules, avoidNames) {
    for (let k = 0; k < count && GA.Plans.recipeGensLeft() > 0; k++) {
      U.toast(`Grandma is writing dinner ${k + 1} of ${count}…`, { ms: 2500 });
      try {
        const r = await GA.AI.generateRecipe({ request: `a ${rules.diet ? rules.diet.toLowerCase() + " " : ""}weeknight dinner, different from: ${avoidNames.join(", ")}` });
        const rec = Store.add("recipes", { ...r, baseServings: r.servings, saved: false, source: "ai" });
        GA.Plans.recordRecipeGen();
        avoidNames.push(r.name);
        planDinner(U.addDays(U.today(), start + k), rec);
      } catch (e) {
        break;
      }
    }
  }

  /* Grandma+ automatic grocery list from the next week's planned recipes. */
  function groceryFromPlan(days = 7) {
    const end = U.addDays(U.today(), days - 1);
    const ids = [...new Set(Store.list("plan").filter((p) => p.recipeId && p.date >= U.today() && p.date <= end).map((p) => p.recipeId))];
    let n = 0;
    ids.forEach((id) => (n += GA.Kitchen.addToGrocery(id).length));
    return n;
  }
  GA.Planner = { mealPlan, groceryFromPlan };

  function nextSlot(items) {
    const last = items[items.length - 1];
    let h = last ? Number(last.time.slice(0, 2)) + 1 : Math.max(8, new Date().getHours() + 1);
    if (h > 22) h = 22;
    return String(h).padStart(2, "0") + ":00";
  }

  function edit(id) {
    const p = Store.find("plan", id);
    if (!p) return;
    U.openSheet({
      title: "Edit plan item",
      body: `<form id="plan-edit">
          <div class="field-row">
            <label class="field"><span>Time</span><input class="input" type="time" name="time" value="${U.esc(p.time)}" required></label>
            <label class="field"><span>Minutes</span><input class="input" type="number" name="duration" min="0" step="5" value="${p.durationMin || ""}" placeholder="Optional"></label>
          </div>
          <label class="field"><span>What</span><input class="input" name="title" value="${U.esc(p.title)}" required maxlength="120"></label>
          <label class="field"><span>Day</span><input class="input" type="date" name="date" value="${U.esc(p.date)}" required></label>
          <div class="sheet-actions split"><button type="button" class="btn ghost" data-del>${U.icon("trash")}Delete</button><button class="btn primary">Save</button></div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#plan-edit");
        f.onsubmit = (e) => {
          e.preventDefault();
          Store.update("plan", id, { time: f.time.value, title: f.title.value.trim() || p.title, durationMin: Number(f.duration.value) || 0, date: U.isValidKey(f.date.value) ? f.date.value : p.date });
          close();
        };
        sheet.querySelector("[data-del]").onclick = () => {
          Store.remove("plan", id);
          close();
        };
      },
    });
  }

  GA.Views = GA.Views || {};
  GA.Views.planner = {
    title: "Planner",
    keys: ["plan", "tasks", "htasks"],
    render(root, params) {
      if (params[0] && U.isValidKey(params[0])) date = params[0];
      render(root);
    },
    refresh(root) {
      const input = U.$("#plan-add [name=title]", root);
      const focused = document.activeElement === input;
      render(root);
      if (focused) U.$("#plan-add [name=title]", root).focus();
    },
  };
})();
