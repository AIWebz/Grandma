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
  const SECTIONS = ["produce", "meat", "dairy", "pantry", "other"];
  const RECIPE_CATS = ["Breakfast", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"];
  const VULGAR = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  const toNumber = (v) => {
    if (typeof v === "number") return isFinite(v) ? v : null;
    const t = String(v == null ? "" : v).trim();
    if (!t) return null;
    let total = 0;
    let any = false;
    for (const part of t.split(/\s+/)) {
      if (VULGAR[part] != null) { total += VULGAR[part]; any = true; continue; }
      const f = part.match(/^(\d+)\/(\d+)$/);
      if (f) { total += Number(f[1]) / Number(f[2]); any = true; continue; }
      const mixed = part.match(/^(\d+)([½¼¾⅓⅔⅛])$/);
      if (mixed) { total += Number(mixed[1]) + VULGAR[mixed[2]]; any = true; continue; }
      if (/^\d*\.?\d+$/.test(part)) { total += Number(part); any = true; continue; }
      break;
    }
    return any ? total : null;
  };
  const UNIT_RE = "cups?|c\\.|tablespoons?|tbsps?|tbs|teaspoons?|tsps?|pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg|ml|milliliters?|liters?|l|cloves?|cans?|pinch(?:es)?|dash(?:es)?|slices?|sticks?|sprigs?|stalks?|bunch(?:es)?|heads?|handfuls?|packages?|pkgs?|jars?|quarts?|qts?|pints?|pts?";
  function parseIngredient(str) {
    const t = String(str).replace(/^[-•*\s]+/, "").trim();
    if (!t) return null;
    const m = t.match(new RegExp("^((?:\\d+\\s+)?\\d+\\/\\d+|\\d+[½¼¾⅓⅔⅛]|\\d*\\.?\\d+|[½¼¾⅓⅔⅛])(?:\\s*([½¼¾⅓⅔⅛]))?\\s*(?:(" + UNIT_RE + ")\\.?\\s+)?(?:of\\s+)?(.+)$", "i"));
    if (!m) return { qty: null, unit: "", item: t };
    return { qty: toNumber(m[1] + (m[2] ? " " + m[2] : "")), unit: m[3] || "", item: m[4].trim() };
  }

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
    /*
     * Turn whatever the model produced into a clean recipe. Small models
     * sometimes write ingredients as plain strings ("1 1/2 cups rice") or
     * steps as one paragraph, so accept those too.
     */
    normalize(input) {
      if (!input || typeof input !== "object") return null;
      const name = String(input.name || input.title || "").trim();
      let ings = input.ingredients || [];
      if (typeof ings === "string") ings = ings.split(/\n|;/);
      const ingredients = (Array.isArray(ings) ? ings : [])
        .map((i) => (typeof i === "string" ? parseIngredient(i) : {
          qty: toNumber(i.qty != null ? i.qty : i.quantity),
          unit: String(i.unit || "").trim(),
          item: String(i.item || i.name || i.ingredient || "").trim(),
          section: i.section,
        }))
        .filter((i) => i && i.item)
        .map((i) => ({ ...i, qty: i.qty > 0 ? i.qty : null, section: SECTIONS.includes(i.section) ? i.section : Grocery.guessSection(i.item) }));
      let steps = input.steps || input.instructions || [];
      if (typeof steps === "string") steps = steps.split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/);
      steps = (Array.isArray(steps) ? steps : []).map((x) => String(typeof x === "object" ? x.text || x.step || "" : x).replace(/^\s*(step\s*)?\d+[.):-]\s*/i, "").trim()).filter(Boolean);
      if (!name || ingredients.length < 2 || !steps.length) return null;
      const int = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
      const tips = (Array.isArray(input.tips) ? input.tips : input.tips ? [input.tips] : []).map(String).map((t) => t.trim()).filter(Boolean).slice(0, 3);
      return {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        description: String(input.description || "").trim(),
        emoji: typeof input.emoji === "string" && input.emoji.trim() && input.emoji.trim().length <= 4 ? input.emoji.trim() : "🍲",
        categories: (input.categories || []).filter((c) => RECIPE_CATS.includes(c)),
        servings: Math.max(1, int(input.servings, 4) || 4),
        prepMinutes: int(input.prep_minutes != null ? input.prep_minutes : input.prepMinutes, 0),
        cookMinutes: int(input.cook_minutes != null ? input.cook_minutes : input.cookMinutes, 0),
        difficulty: ["Easy", "Medium", "Hard"].includes(input.difficulty) ? input.difficulty : "Easy",
        ingredients,
        steps,
        tips,
      };
    },

    /* Store a generated recipe (not saved to "My recipes" until the person saves it). */
    createFrom(input, extra) {
      const r = Kitchen.normalize(input);
      if (!r) return null;
      return Store.add("recipes", { ...r, baseServings: r.servings, saved: false, source: "ai", convId: extra && extra.convId });
    },

    /*
     * What Grandma should know when writing a recipe. Allergies and foods to
     * avoid always count (that's safety). Full personalization — diet, household
     * size, skill, favorite cuisines, and remembered likes — is a Grandma+ perk.
     */
    prefs() {
      const c = Store.doc("settings").cooking || {};
      const lines = [];
      if (c.allergies) lines.push(`Allergies — never use: ${c.allergies}.`);
      const mem = Store.doc("settings").memoryEnabled ? Store.list("memory") : [];
      mem.filter((m) => m.category === "dislikes" || /allerg/i.test(m.fact)).forEach((m) => lines.push(`Avoid: ${m.fact}.`));
      if (GA.Plans.can("cookingPrefs")) {
        if (c.avoid) lines.push(`Doesn't like: ${c.avoid}.`);
        if (c.diet) lines.push(`Diet: ${c.diet}.`);
        if (c.skill) lines.push(`Cooking skill: ${c.skill}.`);
        if (c.cuisines) lines.push(`Favorite cuisines: ${c.cuisines}.`);
        mem.filter((m) => ["likes", "diet", "skill", "household"].includes(m.category)).forEach((m) => lines.push(m.fact + "."));
      }
      return lines.join("\n");
    },
    defaultServings() {
      const c = Store.doc("settings").cooking || {};
      return GA.Plans.can("cookingPrefs") && c.servings ? Number(c.servings) : 4;
    },

    /* No AI available: find the closest built-in recipes to what they typed. */
    findSimilar(text, n = 3) {
      const words = String(text).toLowerCase().match(/[a-z]{3,}/g) || [];
      const stop = new Set(["have", "with", "some", "and", "the", "for", "make", "want", "what", "can", "something", "dinner", "lunch", "breakfast", "recipe", "got", "that", "this", "use"]);
      const keys = words.filter((w) => !stop.has(w));
      if (!keys.length) return [];
      return Kitchen.all()
        .map((r) => {
          const hay = (r.name + " " + r.description + " " + (r.categories || []).join(" ") + " " + r.ingredients.map((i) => i.item).join(" ")).toLowerCase();
          return { r, score: keys.reduce((a, w) => a + (hay.includes(w.replace(/s$/, "")) ? 1 : 0), 0) };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map((x) => x.r);
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
        recurrence: GA.Plans.can("recurring") && ["daily", "weekly", "monthly"].includes(t.recurrence) ? t.recurrence : "none",
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
      if (GA.Plans.recipeGensLeft() <= 0) {
        return {
          result: { created: false, reason: `Daily recipe limit reached on the ${GA.Plans.current().name} plan. Tell them kindly; more recipes come with an upgrade.` },
          card: { type: "upgrade", reason: "recipeGens" },
        };
      }
      const recipe = Kitchen.createFrom(input, extra);
      if (!recipe) return { error: "That recipe was incomplete. Include a name, at least two ingredients with amounts, and the steps." };
      GA.Plans.recordRecipeGen();
      let savedNote = "";
      if (input.save) {
        const s = Kitchen.save(recipe.id, true);
        savedNote = s.error ? "not saved: saved-recipe limit reached on the Free plan" : "saved";
      }
      return {
        result: { recipe_id: recipe.id, name: recipe.name, servings: recipe.servings, status: savedNote || "shown as a card, not saved yet" },
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
      const ahead = Math.round((U.parseKey(input.date) - U.parseKey(U.today())) / 86400000);
      const horizon = GA.Plans.limit("planDays");
      if (ahead >= horizon) {
        return {
          result: { planned: false, reason: `The ${GA.Plans.current().name} plan plans up to ${horizon} day${horizon === 1 ? "" : "s"} ahead. Offer to plan today instead, and mention that weekly planning comes with an upgrade.` },
          card: { type: "upgrade", reason: "planDays" },
        };
      }
      if (input.mode === "replace") Store.list("plan").filter((p) => p.date === input.date).forEach((p) => Store.remove("plan", p.id));
      for (const id of input.remove_ids || []) Store.remove("plan", id);
      const items = (input.items || []).filter((i) => i && i.title && U.isValidTime(i.time));
      const made = items.length ? Store.addMany("plan", items.map((i) => ({ date: input.date, time: i.time, title: i.title.trim(), durationMin: i.duration_minutes || 0, recipeId: i.recipe_id && Kitchen.get(i.recipe_id) ? i.recipe_id : "", done: false }))) : [];
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
