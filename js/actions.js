/*
 * Grandma AI — the action system. Every tool the model can call is
 * implemented here against the real app data, and returns:
 *   result → what the model is told happened
 *   card   → what the chat shows (rendered live from the store)
 * The same helpers back the buttons in the UI, so chat and screens agree.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  /* ---------------- grocery helpers ---------------- */
  const SECTION_WORDS = {
    produce: "apple banana berries strawberr blueberr lemon lime orange grape melon peach pear avocado tomato potato onion garlic shallot scallion lettuce spinach kale cabbage carrot celery cucumber pepper jalapeño jalapeno broccoli cauliflower zucchini squash mushroom corn herb cilantro parsley basil thyme rosemary mint dill ginger green bean peas sweet potato fruit vegetable salad arugula radish beet leek",
    meat: "beef chicken pork turkey sausage bacon ham steak ground lamb fish salmon tuna shrimp cod tilapia meat brisket ribs chorizo pepperoni",
    dairy: "milk cheese butter cream yogurt egg eggs sour cream cheddar mozzarella parmesan ricotta buttermilk half-and-half cottage",
  };
  const PANTRY_WORDS = "flour sugar salt oil vinegar rice pasta noodle bean beans lentil broth stock can canned sauce spice seasoning cumin paprika oregano cinnamon vanilla baking soda powder yeast honey syrup cereal oats bread tortilla crackers nuts peanut ketchup mustard mayo soy chocolate cocoa coffee tea cornstarch cornmeal breadcrumbs";

  const Grocery = {
    guessSection(name) {
      const n = " " + String(name).toLowerCase() + " ";
      for (const [section, words] of Object.entries(SECTION_WORDS)) {
        if (words.split(" ").some((w) => w && n.includes(w))) {
          if (section === "produce" && /\b(powder|dried|ground|sauce|canned|can of|paste)\b/.test(n)) continue;
          return section;
        }
      }
      if (PANTRY_WORDS.split(" ").some((w) => n.includes(w))) return "pantry";
      return "other";
    },
    add(items, source) {
      const existing = Store.list("grocery");
      const made = [];
      for (const it of items) {
        let name = String(it.name || "").trim();
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (!name) continue;
        const dupe = existing.find((g) => !g.checked && g.name.toLowerCase() === name.toLowerCase());
        if (dupe) {
          made.push(dupe);
          continue;
        }
        const section = ["produce", "meat", "dairy", "pantry", "other"].includes(it.section) ? it.section : Grocery.guessSection(name);
        made.push(Store.add("grocery", { name, quantity: it.quantity || "", section, checked: false, source: source || "" }));
      }
      return made;
    },
  };

  /* ---------------- recipes ---------------- */
  const seedList = () => window.GA_SEED_RECIPES || [];

  const Kitchen = {
    get(id) {
      return Store.find("recipes", id) || seedList().find((r) => r.id === id) || null;
    },
    /* Recipes page: seed recipes plus the person's saved ones. */
    all() {
      const mine = Store.list("recipes").filter((r) => r.saved);
      const mineIds = new Set(mine.map((r) => r.id));
      return mine.concat(seedList().filter((r) => !mineIds.has(r.id)));
    },
    isSaved(id) {
      const r = Store.find("recipes", id);
      return Boolean(r && r.saved);
    },
    factor(r) {
      return (r.servings || r.baseServings || 1) / (r.baseServings || r.servings || 1);
    },
    qtyText(ing, factor) {
      const n = ing.qty != null && ing.qty !== "" ? ing.qty * factor : null;
      const q = n != null ? U.formatQty(n) : "";
      return [q, Kitchen.unitFor(ing.unit, n)].filter(Boolean).join(" ");
    },
    /* "1 cup" / "2 cups": units follow the scaled amount. */
    unitFor(unit, n) {
      if (!unit || n == null) return unit || "";
      const plural = { cup: "cups", clove: "cloves", can: "cans", slice: "slices", sprig: "sprigs", stalk: "stalks", handful: "handfuls", pinch: "pinches", stick: "sticks", package: "packages", bunch: "bunches", head: "heads", jar: "jars", quart: "quarts", pint: "pints", pound: "pounds", ounce: "ounces" };
      const singular = Object.fromEntries(Object.entries(plural).map(([a, b]) => [b, a]));
      const [first, ...rest] = unit.split(" ");
      const lower = first.toLowerCase();
      const more = n > 1.0001;
      if (more && plural[lower]) return [plural[lower], ...rest].join(" ");
      if (!more && singular[lower]) return [singular[lower], ...rest].join(" ");
      return unit;
    },
    /* Seed recipes are copied into the store the first time they change. */
    ensureStored(id) {
      let r = Store.find("recipes", id);
      if (r) return r;
      const seed = seedList().find((x) => x.id === id);
      if (!seed) return null;
      return Store.add("recipes", { ...JSON.parse(JSON.stringify(seed)), source: "seed", saved: false });
    },
    save(id, saved = true) {
      if (saved) {
        const count = Store.list("recipes").filter((r) => r.saved).length;
        const lim = GA.Plans.limit("savedRecipes");
        if (!Kitchen.isSaved(id) && count >= lim) return { error: `limit:${lim}` };
      }
      const r = Kitchen.ensureStored(id);
      if (!r) return { error: "Recipe not found" };
      Store.update("recipes", id, { saved });
      return { recipe: r };
    },
    setServings(id, servings) {
      const r = Kitchen.ensureStored(id);
      if (!r) return null;
      return Store.update("recipes", id, { servings: U.clamp(Math.round(servings), 1, 200) });
    },
    addToGrocery(id) {
      const r = Kitchen.get(id);
      if (!r) return [];
      const f = Kitchen.factor(r);
      return Grocery.add(
        r.ingredients.map((ing) => ({ name: ing.item.split(",")[0].trim(), quantity: Kitchen.qtyText(ing, f), section: ing.section })),
        r.name
      );
    },
  };

  /* ---------------- tasks ---------------- */
  const TaskOps = {
    create(t, { shared = false } = {}) {
      const key = shared && Store.doc("household").id ? "htasks" : "tasks";
      const maxOrder = Store.list(key).reduce((m, x) => Math.max(m, x.order || 0), 0);
      return Store.add(key, {
        title: String(t.title).trim(),
        category: t.category || "other",
        dueDate: U.isValidKey(t.due_date || t.dueDate) ? t.due_date || t.dueDate : "",
        dueTime: U.isValidTime(t.due_time || t.dueTime) ? t.due_time || t.dueTime : "",
        recurrence: t.recurrence || "none",
        remind: Boolean(t.remind),
        notes: t.notes || "",
        completed: false,
        order: maxOrder + 1,
      });
    },
    setCompleted(id, completed) {
      const found = Store.findTask(id);
      if (!found) return null;
      const { key, task } = found;
      Store.update(key, id, { completed, completedAt: completed ? Date.now() : null });
      // Recurring tasks roll forward when finished.
      if (completed && task.recurrence && task.recurrence !== "none" && !task.spawnedNext) {
        const base = task.dueDate || U.today();
        const next = task.recurrence === "daily" ? U.addDays(base, 1) : task.recurrence === "weekly" ? U.addDays(base, 7) : U.addMonths(base, 1);
        Store.update(key, id, { spawnedNext: true });
        TaskOps.create({ ...task, due_date: next, due_time: task.dueTime }, { shared: key === "htasks" });
      }
      return task;
    },
  };

  /* ---------------- tool handlers ---------------- */
  const handlers = {
    add_tasks(input) {
      const list = (input.tasks || []).filter((t) => t && t.title).slice(0, 8);
      if (!list.length) return { error: "No tasks given" };
      const made = list.map((t) => TaskOps.create(t));
      return {
        result: { added: made.map((t) => ({ id: t.id, title: t.title, due: t.dueDate || null, time: t.dueTime || null, remind: t.remind })) },
        card: { type: "tasks", heading: input.heading || (made.length === 1 ? "Task added" : "Tasks added"), ids: made.map((t) => t.id) },
      };
    },

    update_tasks(input) {
      const done = [];
      const missing = [];
      for (const u of input.updates || []) {
        const found = Store.findTask(u.task_id);
        if (!found) {
          missing.push(u.task_id);
          continue;
        }
        const { key, task } = found;
        if (u.delete) {
          Store.remove(key, task.id);
          done.push({ id: task.id, title: task.title, deleted: true });
          continue;
        }
        const patch = {};
        if (typeof u.title === "string" && u.title.trim()) patch.title = u.title.trim();
        if (typeof u.due_date === "string") patch.dueDate = U.isValidKey(u.due_date) ? u.due_date : "";
        if (typeof u.due_time === "string") patch.dueTime = U.isValidTime(u.due_time) ? u.due_time : "";
        if (Object.keys(patch).length) Store.update(key, task.id, patch);
        if (typeof u.completed === "boolean") TaskOps.setCompleted(task.id, u.completed);
        done.push({ id: task.id, title: patch.title || task.title, completed: u.completed });
      }
      if (!done.length) return { error: "No matching tasks: " + missing.join(", ") };
      const kept = done.filter((d) => !d.deleted).map((d) => d.id);
      return {
        result: { updated: done, not_found: missing },
        card: kept.length ? { type: "tasks", heading: "Tasks updated", ids: kept } : { type: "note", icon: "trash", text: `Removed ${done.length === 1 ? `"${done[0].title}"` : done.length + " tasks"}` },
      };
    },

    add_grocery_items(input) {
      const made = Grocery.add(input.items || [], input.heading || "");
      if (!made.length) return { error: "No items given" };
      return {
        result: { added: made.map((g) => ({ id: g.id, name: g.name })) },
        card: { type: "grocery", heading: input.heading ? `${input.heading} grocery list` : "Added to your grocery list", ids: made.map((g) => g.id) },
      };
    },

    update_grocery_items(input) {
      let n = 0;
      for (const u of input.updates || []) {
        if (!Store.find("grocery", u.item_id)) continue;
        if (u.delete) Store.remove("grocery", u.item_id);
        else if (typeof u.checked === "boolean") Store.update("grocery", u.item_id, { checked: u.checked });
        n++;
      }
      if (input.clear_checked) {
        Store.list("grocery").filter((g) => g.checked).forEach((g) => { Store.remove("grocery", g.id); n++; });
      }
      return { result: { changed: n }, card: { type: "note", icon: "cart", text: `Grocery list updated (${n} item${n === 1 ? "" : "s"})` } };
    },

    create_recipe(input, extra) {
      const ingredients = (input.ingredients || []).map((i) => ({
        qty: typeof i.qty === "number" && isFinite(i.qty) && i.qty > 0 ? i.qty : null,
        unit: i.unit || "",
        item: String(i.item || "").trim(),
        section: i.section || Grocery.guessSection(i.item || ""),
      })).filter((i) => i.item);
      const steps = (input.steps || []).map((s) => String(s).trim()).filter(Boolean);
      if (!input.name || !ingredients.length || !steps.length) return { error: "A recipe needs a name, ingredients, and steps." };
      const servings = Math.max(1, Math.round(input.servings || 4));
      const recipe = Store.add("recipes", {
        name: input.name.trim(),
        description: input.description || "",
        emoji: input.emoji || "🍲",
        categories: input.categories || [],
        servings,
        baseServings: servings,
        prepMinutes: input.prep_minutes || 0,
        cookMinutes: input.cook_minutes || 0,
        difficulty: input.difficulty || "Easy",
        ingredients,
        steps,
        tips: input.tips || [],
        saved: false,
        source: "ai",
        convId: extra && extra.convId,
      });
      let savedNote = "";
      if (input.save) {
        const s = Kitchen.save(recipe.id, true);
        savedNote = s.error ? "not saved: saved-recipe limit reached on the Free plan" : "saved";
      }
      return {
        result: { recipe_id: recipe.id, name: recipe.name, servings, status: savedNote || "shown as a card, not saved yet" },
        card: { type: "recipe", id: recipe.id },
      };
    },

    scale_recipe(input) {
      const r = Kitchen.setServings(input.recipe_id, input.servings);
      if (!r) return { error: "Recipe not found" };
      return { result: { recipe_id: r.id, servings: r.servings }, card: { type: "recipe", id: r.id } };
    },

    save_recipe(input) {
      const s = Kitchen.save(input.recipe_id, true);
      if (s.error && s.error.startsWith("limit")) return { result: { saved: false, reason: "Free plan saved-recipe limit reached; Grandma+ has unlimited saving." }, card: { type: "upgrade", reason: "recipes" } };
      if (s.error) return { error: s.error };
      return { result: { saved: true, name: s.recipe.name }, card: { type: "note", icon: "bookmark", text: `Saved "${s.recipe.name}" to your recipes`, link: { label: "View recipes", route: "recipes" } } };
    },

    add_recipe_to_grocery(input) {
      const r = Kitchen.get(input.recipe_id);
      if (!r) return { error: "Recipe not found" };
      const made = Kitchen.addToGrocery(r.id);
      return {
        result: { added: made.length, recipe: r.name },
        card: { type: "grocery", heading: `${r.name} grocery list`, ids: made.map((g) => g.id) },
      };
    },

    plan_day(input) {
      if (!U.isValidKey(input.date)) return { error: "date must be YYYY-MM-DD" };
      if (input.mode === "replace") Store.list("plan").filter((p) => p.date === input.date).forEach((p) => Store.remove("plan", p.id));
      for (const id of input.remove_ids || []) Store.remove("plan", id);
      const items = (input.items || []).filter((i) => i && i.title && U.isValidTime(i.time));
      const made = items.length ? Store.addMany("plan", items.map((i) => ({ date: input.date, time: i.time, title: i.title.trim(), durationMin: i.duration_minutes || 0, done: false }))) : [];
      return { result: { date: input.date, items: made.map((p) => ({ id: p.id, time: p.time, title: p.title })) }, card: { type: "plan", date: input.date } };
    },

    remember(input) {
      if (!Store.doc("settings").memoryEnabled) return { error: "Memory is turned off by the person." };
      const fact = String(input.fact || "").trim();
      if (!fact) return { error: "Nothing to remember" };
      const mem = Store.list("memory");
      const dupe = mem.find((m) => m.fact.toLowerCase() === fact.toLowerCase());
      if (dupe) return { result: { already_remembered: dupe.id } };
      const lim = GA.Plans.limit("memory");
      if (mem.length >= lim) return { result: { remembered: false, reason: `Memory full on this plan (${lim}).` }, card: { type: "upgrade", reason: "memory" } };
      const m = Store.add("memory", { category: input.category || "other", fact });
      return { result: { remembered: true, id: m.id }, card: { type: "memory", id: m.id } };
    },

    forget(input) {
      const m = Store.find("memory", input.memory_id);
      if (!m) return { error: "Memory not found" };
      Store.remove("memory", m.id);
      return { result: { forgotten: m.fact }, card: { type: "note", icon: "brain", text: `Forgot: ${m.fact}` } };
    },
  };

  const Actions = {
    run(name, input, extra) {
      const h = handlers[name];
      if (!h) return { error: "Unknown tool " + name };
      return h(input, extra) || { result: { ok: true } };
    },
  };

  GA.Actions = Actions;
  GA.Kitchen = Kitchen;
  GA.Grocery = Grocery;
  GA.TaskOps = TaskOps;
})();
