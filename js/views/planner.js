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
        ${GA.Birthdays && GA.Birthdays.on(date).length ? `<div class="card note bday-today">🎂<span class="grow">${GA.Birthdays.on(date).map((b) => `<strong>${U.esc(b.name)}</strong>'s birthday${GA.Birthdays.turning(b) && GA.Birthdays.next(b) === date ? ` (turning ${GA.Birthdays.turning(b)})` : ""}`).join(", ")}</span><button class="btn small" data-bday-card="${U.esc(GA.Birthdays.on(date)[0].name)}">Make a card</button></div>` : ""}
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
        ${GA.Birthdays ? GA.Birthdays.sectionHTML() : ""}
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
      if (e.target.closest("[data-plan-ai]")) return askEvents({ scope: "day", date });
      if (e.target.closest("[data-meal-plan]")) {
        if (!GA.Plans.gate("mealPlan", "Weekly meal planning")) return;
        const offerList = () => U.toast("Your week of dinners is planned ❤️", { ms: 6000, action: { label: "Make grocery list", run: () => { const n = GA.Planner.groceryFromPlan(); U.toast(`Added ${n} items to your grocery list`); } } });
        const res = mealPlan(7, offerList);
        if (!res.planned && !res.writing) return U.toast("I couldn't find dinners that fit your preferences. Turn on Grandma's AI or save a few recipes first.");
        if (!res.writing) offerList();
        return render(root);
      }
      if (e.target.closest("[data-week-plan]")) return askEvents({ scope: "week", date: U.today() });
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

  /* ================= Plan my day / week =================
   * Grandma asks what's happening first, then fits breakfast, lunch, and dinner
   * around those events and picks a recipe for each meal: nothing she already
   * picked this week, nothing they're allergic to or dislike, and something
   * quick on busy days.
   */
  const MEALS = [
    { key: "breakfast", label: "Breakfast", time: "08:00", window: ["07:00", "10:00"], skip: /breakfast|brunch/i },
    { key: "lunch", label: "Lunch", time: "12:30", window: ["11:00", "14:00"], skip: /lunch|brunch/i },
    { key: "dinner", label: "Dinner", time: "18:30", window: ["17:00", "20:30"], skip: /dinner|supper|potluck|restaurant|eat(ing)? out|cookout|barbecue|bbq/i },
  ];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toTime = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const LUNCHY = /soup|sandwich|salad|wrap|taco|quesadilla|grilled cheese|chili|burger|melt|bowl|noodle/i;

  function poolFor(meal, rules) {
    const all = GA.Kitchen.all().filter((r) => !r.ingredients.some((i) => rules.avoid.some((w) => i.item.toLowerCase().includes(w))) && !(rules.veg && r.ingredients.some((i) => i.section === "meat" || MEAT.test(i.item))));
    const cats = (r) => r.categories || [];
    if (meal === "breakfast") return all.filter((r) => cats(r).includes("Breakfast"));
    if (meal === "lunch") return all.filter((r) => cats(r).includes("Lunch") || (LUNCHY.test(r.name) && !cats(r).some((c) => ["Desserts", "Baking", "Breakfast"].includes(c)) && GA.Kitchen.totalMinutes(r) <= 45));
    return all.filter((r) => fits(r, rules));
  }

  /* Grandma's pick for one meal. */
  function pickRecipe(meal, rules, used, maxMinutes) {
    const pool = poolFor(meal, rules);
    const fresh = pool.filter((r) => !used.has(r.name));
    const quick = (list) => (maxMinutes ? list.filter((r) => GA.Kitchen.totalMinutes(r) <= maxMinutes) : list);
    const ranked = (list) => list.map((r) => ({ r, score: (GA.Kitchen.isSaved(r.id) ? 2 : 0) + Math.random() * 1.5 })).sort((a, b) => b.score - a.score).map((x) => x.r);
    const choice = ranked(quick(fresh))[0] || ranked(fresh)[0] || ranked(quick(pool))[0] || ranked(pool)[0] || null;
    if (choice) used.add(choice.name);
    return choice;
  }

  /* A free time for a meal near its usual time, clear of the day's events. */
  function mealTime(meal, busy) {
    const [from, to] = meal.window.map(toMin);
    const clear = (m) => busy.every(([s, e]) => m + 30 <= s || m >= e);
    const start = toMin(meal.time);
    for (let d = 0; d <= to - from; d += 15) {
      for (const m of [start + d, start - d]) if (m >= from && m <= to && clear(m)) return toTime(m);
    }
    return null;
  }

  /*
   * Add breakfast, lunch, and dinner to a day around what's already on it.
   * Returns how many meals were added. Meals the events already cover
   * ("dinner at Mom's") are skipped.
   */
  function addMeals(day, { rules = mealRules(), used = new Set(), which = ["breakfast", "lunch", "dinner"] } = {}) {
    Store.list("plan").filter((p) => p.date === day && p.autoMeal).forEach((p) => Store.remove("plan", p.id));
    const items = itemsFor(day);
    const busy = items.map((p) => [toMin(p.time), toMin(p.time) + (p.durationMin || 60)]);
    const busyEvening = items.some((p) => toMin(p.time) >= 15 * 60 && toMin(p.time) < 19 * 60);
    const packed = items.length >= 3;
    let added = 0;
    for (const meal of MEALS) {
      if (!which.includes(meal.key) || items.some((p) => meal.skip.test(p.title))) continue;
      const time = mealTime(meal, busy);
      if (!time) continue;
      const quickFor = meal.key === "breakfast" ? 20 : meal.key === "lunch" ? 25 : busyEvening || packed ? 35 : 0;
      const r = pickRecipe(meal.key, rules, used, quickFor);
      Store.add("plan", {
        date: day,
        time,
        title: r ? `${meal.label}: ${r.name}` : meal.label,
        durationMin: r ? Math.min(GA.Kitchen.totalMinutes(r), 90) || 30 : 30,
        recipeId: r ? r.id : "",
        autoMeal: true,
        mealPlan: meal.key === "dinner",
        done: false,
      });
      busy.push([toMin(time), toMin(time) + 30]);
      added++;
    }
    return added;
  }

  /* Put their events on the calendar, then the meals. */
  function buildPlan(days, events, which) {
    const rules = mealRules();
    const used = new Set();
    for (const day of days) {
      for (const ev of events.filter((x) => x.date === day)) {
        Store.add("plan", { date: day, time: ev.time, title: ev.title, durationMin: ev.duration || 60, event: true, done: false });
      }
      addMeals(day, { rules, used, which });
    }
  }

  /* "What's happening?" — the question Grandma asks before planning. */
  const daysFor = (scope, start) => (scope === "week" ? Array.from({ length: 7 }, (_, i) => U.addDays(start, i)) : [start]);
  /* Free plans look a couple of days ahead; whole weeks are a Pro perk. */
  function allowed(scope, days) {
    if (scope === "week") return GA.Plans.gate("weekPlan", "Whole-week planning");
    const ahead = Math.round((U.parseKey(days[days.length - 1]) - U.parseKey(U.today())) / 86400000);
    return ahead < GA.Plans.limit("planDays") || GA.Plans.gate("weekPlan", `Planning ${ahead + 1} days ahead`);
  }

  /* "Nothing special": plan the meals right away. */
  function planNow({ scope = "day", date: startDate = U.today(), onPlanned } = {}) {
    const days = daysFor(scope, startDate);
    if (!allowed(scope, days)) return false;
    buildPlan(days, [], MEALS.map((m) => m.key));
    if (onPlanned) onPlanned({ days, events: [] });
    return true;
  }

  function askEvents({ scope = "day", date: startDate = U.today(), onPlanned } = {}) {
    const days = daysFor(scope, startDate);
    if (!allowed(scope, days)) return;
    const dayName = (d) => (d === U.today() ? "Today" : d === U.addDays(U.today(), 1) ? "Tomorrow" : U.parseKey(d).toLocaleDateString(undefined, { weekday: "long" }));
    const row = () => `<div class="event-row">
        ${scope === "week" ? `<select class="select" name="day" aria-label="Day">${days.map((d) => `<option value="${d}">${U.esc(dayName(d))}</option>`).join("")}</select>` : ""}
        <input class="input" type="time" name="time" aria-label="Time" value="09:00">
        <input class="input grow" name="title" placeholder="${scope === "week" ? "Soccer practice, work, doctor…" : "Dentist, work, pick up kids…"}" aria-label="Event" maxlength="80">
        <button type="button" class="icon-btn" data-row-remove aria-label="Remove">${U.icon("x")}</button>
      </div>`;
    U.openSheet({
      title: scope === "week" ? "Let's plan your week" : `Let's plan ${dayName(startDate).toLowerCase() === "today" ? "your day" : dayName(startDate)}`,
      body: `<form id="events-form" class="events-form">
          <div class="setup-hero">${U.avatar(48)}<p>${scope === "week" ? "What's happening this week, sweetheart?" : "What's happening, sweetheart?"} Tell me about appointments, work, practices, or plans, and I'll fit breakfast, lunch, and dinner around them with recipes I pick for you.</p></div>
          <div class="event-rows">${row()}</div>
          <button type="button" class="btn ghost small" data-row-add>${U.icon("plus")}Add another</button>
          <fieldset class="meal-picks"><legend>Plan these meals</legend>
            ${MEALS.map((m) => `<label class="chk"><input type="checkbox" name="meal" value="${m.key}" checked> ${m.label}</label>`).join("")}
          </fieldset>
          <div class="sheet-actions split"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${U.icon("sparkle")}Plan it</button></div>
        </form>`,
      onMount(sheet, close) {
        const f = sheet.querySelector("#events-form");
        const rows = f.querySelector(".event-rows");
        f.addEventListener("click", (e) => {
          if (e.target.closest("[data-row-add]")) {
            rows.insertAdjacentHTML("beforeend", row());
            rows.lastElementChild.querySelector("[name=title]").focus();
          }
          const rm = e.target.closest("[data-row-remove]");
          if (rm) rm.closest(".event-row").remove();
        });
        f.onsubmit = (e) => {
          e.preventDefault();
          const events = [...f.querySelectorAll(".event-row")]
            .map((r) => ({ date: r.querySelector("[name=day]") ? r.querySelector("[name=day]").value : startDate, time: r.querySelector("[name=time]").value, title: r.querySelector("[name=title]").value.trim() }))
            .filter((x) => x.title && U.isValidTime(x.time));
          const which = [...f.querySelectorAll("[name=meal]:checked")].map((x) => x.value);
          buildPlan(days, events, which);
          close();
          date = startDate;
          const grocery = GA.Plans.can("autoGrocery") ? { label: "Make grocery list", run: () => U.toast(`Added ${groceryFromPlan(days.length)} items to your grocery list`) } : undefined;
          U.toast(scope === "week" ? "Your week is planned ❤️" : "Your day is planned ❤️", { ms: 6000, action: grocery });
          if (onPlanned) onPlanned({ days, events });
          else GA.App.go("planner");
        };
      },
    });
  }

  /* Grandma+ automatic grocery list from the next week's planned recipes. */
  function groceryFromPlan(days = 7) {
    const end = U.addDays(U.today(), days - 1);
    const ids = [...new Set(Store.list("plan").filter((p) => p.recipeId && p.date >= U.today() && p.date <= end).map((p) => p.recipeId))];
    let n = 0;
    ids.forEach((id) => (n += GA.Kitchen.addToGrocery(id).length));
    return n;
  }
  GA.Planner = { mealPlan, groceryFromPlan, askEvents, planNow, addMeals, buildPlan };

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
    keys: ["birthdays", "plan", "tasks", "htasks"],
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
