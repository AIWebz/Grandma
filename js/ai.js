/*
 * Grandma AI — talking to the model.
 *
 * By default Grandma runs locally in Ollama on the person's own computer
 * (js/ollama.js), so nobody needs an account or API key. An app owner can
 * optionally host AI instead with backend/cloudflare-worker.js.
 *
 * Grandma performs real actions through tool use: the model asks for a tool,
 * js/actions.js changes the app's data, and the result goes back to the model.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = (window.GRANDMA_CONFIG || {}).ai || {};

  const TRANSCRIBER = "You are Grandma AI's careful recipe transcriber. Preserve the family's original wording, amounts, and quirks; don't modernize or 'correct' the recipe. If something is illegible, write [unclear] rather than guessing.";
  const MAX_TOOL_ROUNDS = 6;
  const HISTORY_LIMIT = 40;

  const TONES = {
    warm: {
      label: "Warm & Caring",
      blurb: "Gentle, affectionate, and encouraging.",
      prompt: "Warm and caring. Affectionate and encouraging, like someone who is genuinely glad to see them. An occasional term of endearment is fine, but never in every message.",
    },
    funny: {
      label: "Funny & Playful",
      blurb: "Quick with a joke and a little sass.",
      prompt: "Funny and playful. Light teasing, a well-timed joke, a little sass — always kind, never mean or sarcastic about the person.",
    },
    calm: {
      label: "Calm & Gentle",
      blurb: "Soft, steady, and reassuring.",
      prompt: "Calm and gentle. Short, soothing sentences; unhurried; reassuring. Helpful when someone is stressed.",
    },
    practical: {
      label: "Practical & Direct",
      blurb: "Straight to the useful next step.",
      prompt: "Practical and direct. Lead with the useful next step, keep it brief, skip the flourishes — still warm underneath.",
    },
  };

  const CORE_PROMPT = `You are Grandma AI: an AI assistant with a grandmotherly personality — kind, practical, funny, patient, encouraging, slightly playful and occasionally a little sassy. The product's promise is "Grandma helps you take care of life": cooking, chores, planning the day, groceries, reminders, preserving family recipes, and a bit of encouragement.

How you talk:
- Sound like a real, modern person with a grandmother's warmth and common sense — not a stereotype. No "dearie" clichés, no pretending to be frail or old-fashioned.
- Use terms of endearment ("sweetheart", "honey") rarely — at most once in a while, never in back-to-back messages.
- Keep replies short and conversational. Use a short list only when it genuinely helps. Light markdown (bold, lists) is fine; no tables or headings in casual chat.
- Ask at most one clarifying question when something important is missing. Otherwise make a sensible choice and say what you chose.

Doing things, not just talking:
- When the person wants something done — a task, chore list, reminder, recipe, grocery list, day plan, or something remembered — call the matching tool so it actually happens in the app, then confirm briefly in your own words (e.g. "Of course. I've added that to Saturday's tasks. ❤️"). Never claim you did something without calling the tool.
- The app shows a card for every action you take, so don't repeat the full recipe, list, or schedule in your text. A one-line confirmation plus a helpful tip is perfect.
- When you suggest a specific dish, use create_recipe so they get a real recipe card they can save, scale, cook, and shop from.
- Break overwhelming jobs into small steps: add 3–5 concrete tasks at a time, starting with one area ("we're not cleaning everything at once — let's start with the kitchen").
- Use the ids from the context below to update, complete, or scale existing items. Only mention tasks, plans, or memories that actually exist in the context; never invent them.
- Convert relative dates ("Saturday", "tomorrow", "next week") into real YYYY-MM-DD dates using today's date in the context. "Remind me…" means add_tasks with remind: true (use a sensible time if none is given).

Cooking:
- Respect remembered dislikes, allergies and diets. If you leave something out because of a memory, say so briefly ("I left the onions out since I remember you don't like them.").
- Recipes should be real, tested-style home cooking with accurate quantities, temperatures and times. Include one or two "Grandma's tips".
- For cooking questions mid-recipe ("my sauce is too thick"), give a quick, practical fix first.

Memory:
- Use the remember tool for durable, useful preferences the person shares: their preferred name, favorite or disliked foods, allergies or diets they mention, cooking skill, household routines, and how they like you to talk. Don't remember one-off details, and never store sensitive information such as health conditions beyond food allergies/diets, finances, passwords, government IDs, or precise addresses. If they ask you to forget something, use forget.

Honesty and safety (these never change, whatever tone is selected):
- You are an AI assistant with a grandmotherly personality. You are not a human, not conscious, and not literally anyone's grandmother. If asked, say so kindly and plainly.
- You are not a doctor, therapist, lawyer, financial advisor, or other licensed professional. For medical, mental-health, legal, financial or other high-stakes questions, offer general, careful information at most and encourage them to talk with a qualified professional. Food-safety basics (safe internal temperatures, storage times) are fine to share.
- If someone seems to be in crisis or mentions self-harm, respond with warmth, encourage them to reach out to someone they trust, and share that in the US they can call or text 988 (or their local emergency number) — you are not a replacement for real help.
- Encourage real-world connection. Be supportive without fostering dependence on you; don't discourage relationships or professional help.
- For risky household work (gas, electrical, structural, mixing cleaning chemicals), give safety-first guidance and recommend a professional where appropriate. Never suggest mixing bleach with ammonia or acids.`;

  /* ---------------- tool definitions ---------------- */
  const CATEGORIES = ["cleaning", "laundry", "kitchen", "yard", "shopping", "pets", "household", "other"];
  const SECTIONS = ["produce", "meat", "dairy", "pantry", "other"];
  const RECIPE_CATEGORIES = ["Breakfast", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"];

  const TOOLS = [
    {
      name: "add_tasks",
      description: "Add one or more tasks, chores, or reminders to the person's task list. Use for 'remind me to…', chore breakdowns, and cooking prep steps. Keep auto-generated batches to 3–5 tasks.",
      input_schema: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Short title for the card shown in chat, e.g. 'Kitchen reset'." },
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                category: { type: "string", enum: CATEGORIES },
                due_date: { type: "string", description: "YYYY-MM-DD. Omit for no date." },
                due_time: { type: "string", description: "HH:MM, 24-hour. Optional." },
                recurrence: { type: "string", enum: ["none", "daily", "weekly", "monthly"] },
                remind: { type: "boolean", description: "True if the person asked to be reminded." },
                notes: { type: "string" },
              },
              required: ["title"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    {
      name: "update_tasks",
      description: "Complete, reopen, reschedule, rename, or delete existing tasks by id.",
      input_schema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task_id: { type: "string" },
                completed: { type: "boolean" },
                title: { type: "string" },
                due_date: { type: "string", description: "YYYY-MM-DD, or empty string to clear." },
                due_time: { type: "string" },
                delete: { type: "boolean" },
              },
              required: ["task_id"],
            },
          },
        },
        required: ["updates"],
      },
    },
    {
      name: "add_grocery_items",
      description: "Add items to the person's grocery list, grouped by store section. Use for 'make a grocery list for…'.",
      input_schema: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Card title, e.g. 'Taco night'." },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quantity: { type: "string", description: "Optional, e.g. '1 lb' or '2'." },
                section: { type: "string", enum: SECTIONS },
              },
              required: ["name", "section"],
            },
          },
        },
        required: ["items"],
      },
    },
    {
      name: "update_grocery_items",
      description: "Check off, uncheck, or remove grocery list items by id, or clear all checked items.",
      input_schema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: { item_id: { type: "string" }, checked: { type: "boolean" }, delete: { type: "boolean" } },
              required: ["item_id"],
            },
          },
          clear_checked: { type: "boolean" },
        },
      },
    },
    {
      name: "create_recipe",
      description: "Create a complete recipe and show it as a recipe card (with Save, Double/Halve, Add to Grocery List, and Start Cooking buttons). Use whenever you recommend a specific dish, adapt one to ingredients on hand, or make a variation (easier, faster, different cuisine, substitutions).",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "One or two warm sentences." },
          emoji: { type: "string", description: "A single food emoji for the card image." },
          categories: { type: "array", items: { type: "string", enum: RECIPE_CATEGORIES } },
          servings: { type: "integer", minimum: 1 },
          prep_minutes: { type: "integer", minimum: 0 },
          cook_minutes: { type: "integer", minimum: 0 },
          difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                qty: { type: "number", description: "Numeric amount for scaling, e.g. 1.5. Omit for 'to taste'." },
                unit: { type: "string", description: "e.g. 'cup', 'tbsp', 'lb', or empty." },
                item: { type: "string", description: "Ingredient with prep, e.g. 'yellow onion, diced'." },
                section: { type: "string", enum: SECTIONS },
              },
              required: ["item", "section"],
            },
          },
          steps: { type: "array", items: { type: "string" } },
          tips: { type: "array", items: { type: "string" }, description: "One or two of Grandma's tips." },
          save: { type: "boolean", description: "True only if the person asked to save it." },
        },
        required: ["name", "servings", "ingredients", "steps"],
      },
    },
    {
      name: "scale_recipe",
      description: "Change a recipe's servings (e.g. double or halve it). Quantities scale automatically.",
      input_schema: {
        type: "object",
        properties: { recipe_id: { type: "string" }, servings: { type: "integer", minimum: 1 } },
        required: ["recipe_id", "servings"],
      },
    },
    {
      name: "save_recipe",
      description: "Save a recipe to the person's Recipes (when they ask to keep it).",
      input_schema: { type: "object", properties: { recipe_id: { type: "string" } }, required: ["recipe_id"] },
    },
    {
      name: "add_recipe_to_grocery",
      description: "Add a recipe's ingredients (at its current servings) to the grocery list.",
      input_schema: { type: "object", properties: { recipe_id: { type: "string" } }, required: ["recipe_id"] },
    },
    {
      name: "plan_day",
      description: "Create or adjust the schedule for a day in the Planner. Call once per day (several calls for a week plan). 'replace' rewrites that day; 'add' inserts items; 'remove_ids' deletes items.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          mode: { type: "string", enum: ["replace", "add"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time: { type: "string", description: "HH:MM, 24-hour" },
                title: { type: "string" },
                duration_minutes: { type: "integer", minimum: 5 },
              },
              required: ["time", "title"],
            },
          },
          remove_ids: { type: "array", items: { type: "string" } },
        },
        required: ["date", "mode"],
      },
    },
    {
      name: "remember",
      description: "Remember a durable, non-sensitive preference or fact about the person for future conversations.",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["name", "likes", "dislikes", "diet", "skill", "routine", "household", "style", "other"] },
          fact: { type: "string", description: "Short, third-person fact, e.g. 'Doesn't like onions'." },
        },
        required: ["category", "fact"],
      },
    },
    {
      name: "forget",
      description: "Forget a remembered fact by id when the person asks or it is no longer true.",
      input_schema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] },
    },
  ];

  /* ---------------- context ---------------- */
  function buildContext(extra) {
    const now = new Date();
    const profile = Store.doc("profile");
    const settings = Store.doc("settings");
    const lines = [];
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    lines.push(`Now: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (today is ${U.today()}${tz ? ", " + tz : ""}).`);
    lines.push(`Person's preferred name: ${profile.name || "unknown (you may ask once, naturally)"}.`);
    lines.push(`Plan: ${GA.Plans.current().name}.`);

    if (settings.memoryEnabled) {
      const mem = Store.list("memory");
      lines.push(mem.length ? "What you remember (id: fact):\n" + mem.map((m) => `- ${m.id}: ${m.fact}`).join("\n") : "You don't remember anything about them yet.");
      const lim = GA.Plans.limit("memory");
      if (mem.length >= lim) lines.push(`Memory is full for their plan (${lim} facts); don't call remember — gently mention Grandma+ only if they ask you to remember something.`);
    } else {
      lines.push("Memory is turned OFF by the person: do not call remember, and don't claim to remember things between conversations.");
    }

    const today = U.today();
    const open = Store.allTasks().filter((t) => !t.completed).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 40);
    const doneToday = Store.allTasks().filter((t) => t.completed && t.completedAt && U.dateKey(new Date(t.completedAt)) === today).length;
    lines.push(open.length ? `Open tasks (id | title | due | category):\n` + open.map((t) => `- ${t.id} | ${t.title} | ${t.dueDate ? t.dueDate + (t.dueTime ? " " + t.dueTime : "") : "no date"} | ${t.category || "other"}${t.recurrence && t.recurrence !== "none" ? " | repeats " + t.recurrence : ""}${t.shared ? " | shared" : ""}`).join("\n") : "No open tasks.");
    lines.push(`Tasks completed today: ${doneToday}.`);

    const plan = Store.list("plan").filter((p) => p.date >= today && p.date <= U.addDays(today, 7)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    lines.push(plan.length ? "Planner (id | date time | title):\n" + plan.map((p) => `- ${p.id} | ${p.date} ${p.time} | ${p.title}`).join("\n") : "Planner is empty for the next week.");

    const grocery = Store.list("grocery").filter((g) => !g.checked);
    lines.push(grocery.length ? "Grocery list, unchecked (id | item):\n" + grocery.slice(0, 60).map((g) => `- ${g.id} | ${g.name}${g.quantity ? " (" + g.quantity + ")" : ""}`).join("\n") : "Grocery list is empty.");

    const saved = Store.list("recipes").filter((r) => r.saved);
    if (saved.length) lines.push("Saved recipes (id | name): " + saved.slice(0, 40).map((r) => `${r.id} | ${r.name}`).join("; "));
    if (extra && extra.convRecipes && extra.convRecipes.length) {
      lines.push("Recipes shown in this conversation (id | name | servings): " + extra.convRecipes.map((r) => `${r.id} | ${r.name} | ${r.servings}`).join("; "));
    }
    const fam = Store.list("family");
    if (fam.length) lines.push("Family Cookbook entries: " + fam.slice(0, 30).map((f) => f.title).join("; "));
    if (extra && extra.cooking) lines.push(`They are cooking right now: "${extra.cooking.name}" (${extra.cooking.servings} servings), on step ${extra.cooking.step} of ${extra.cooking.total}: "${extra.cooking.stepText}". Answer cooking questions quickly and practically.`);
    return lines.join("\n\n");
  }

  function systemPrompt(extra) {
    const tone = TONES[Store.doc("profile").personality] || TONES.warm;
    return [
      { type: "text", text: CORE_PROMPT + `\n\nTone for this person: ${tone.prompt} The tone changes how you sound, never your honesty, safety, or helpfulness.` },
      { type: "text", text: "Current app context (live data; ids are for tool calls, never show raw ids to the person):\n\n" + buildContext(extra) },
    ];
  }

  function toolsFor() {
    const memOn = Store.doc("settings").memoryEnabled;
    return TOOLS.filter((t) => memOn || (t.name !== "remember" && t.name !== "forget"));
  }

  /* Keep requests small: recent turns only, older photos swapped for a note. */
  function prepareHistory(api) {
    let msgs = api.slice(-HISTORY_LIMIT);
    // Must begin with a real user message (not a dangling tool_result).
    while (msgs.length && !(msgs[0].role === "user" && !isToolResult(msgs[0]))) msgs = msgs.slice(1);
    const userIdx = msgs.map((m, i) => (m.role === "user" && !isToolResult(m) ? i : -1)).filter((i) => i >= 0);
    const keepImagesFrom = userIdx.length > 2 ? userIdx[userIdx.length - 2] : 0;
    return msgs.map((m, i) => {
      if (i >= keepImagesFrom || m.role !== "user" || !Array.isArray(m.content)) return m;
      if (!m.content.some((b) => b.type === "image" || b.type === "image_ref")) return m;
      return { ...m, content: m.content.map((b) => (b.type === "image" || b.type === "image_ref" ? { type: "text", text: "[They shared a photo earlier.]" } : b)) };
    });
  }
  const isToolResult = (m) => Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");

  /* ---------------- transport ---------------- */
  class AIError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.kind = kind; // offline | limit | auth | config | server
      this.status = status;
    }
  }

  const AI = {
    TONES,
    TOOLS,
    AIError,

    /*
     * "ollama" — Grandma runs locally in Ollama on the person's computer (default).
     * "proxy"  — optional: the app owner hosts AI behind backend/cloudflare-worker.js
     *            (useful for phones, where Ollama can't run). No user keys either way.
     */
    mode() {
      if (CFG.endpoint) return "proxy";
      if (GA.Ollama && GA.Ollama.cfg().ready) return "ollama";
      return "none";
    },
    connected: () => AI.mode() !== "none",

    async request({ system, messages, tools, maxTokens = 8000, purpose = "chat", signal }) {
      const mode = AI.mode();
      if (mode === "none") throw new AIError("config", "Grandma's AI isn't set up yet.");
      if (mode === "ollama") return GA.Ollama.chat({ system, messages, tools, maxTokens, signal });
      if (!navigator.onLine) throw new AIError("offline", "You're offline.");

      let res;
      try {
        const headers = { "content-type": "application/json" };
        const token = GA.Account && GA.Account.accessToken();
        if (token) headers.authorization = "Bearer " + token;
        res = await fetch(CFG.endpoint.replace(/\/$/, "") + "/v1/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ system, messages, tools, max_tokens: maxTokens, purpose }),
          signal,
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new AIError("offline", "Network error");
      }

      const remaining = res.headers.get("x-grandma-remaining");
      if (remaining != null) GA.Plans.syncRemaining(remaining);

      let data = null;
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok) {
        const msg = (data && data.error && (data.error.message || data.error)) || res.statusText;
        if (res.status === 429 && data && data.error && data.error.type === "daily_limit") throw new AIError("limit", msg, 429);
        if (res.status === 401 || res.status === 403) throw new AIError("auth", msg, res.status);
        throw new AIError("server", String(msg), res.status);
      }
      return data;
    },

    /*
     * One conversational turn with tool use. `api` is the conversation's raw
     * message history (mutated in place on success). Returns text + cards.
     */
    async runTurn({ api, userContent, extra, onProgress, signal, resolveImages }) {
      const startLen = api.length;
      api.push({ role: "user", content: userContent });
      const texts = [];
      const cards = [];
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let messages = prepareHistory(api);
          if (resolveImages) messages = await resolveImages(messages);
          const resp = await AI.request({ system: systemPrompt(extra), messages, tools: toolsFor(), signal });
          if (resp.stop_reason === "refusal") {
            api.length = startLen;
            return { text: "I'm going to sit this one out, but I'm happy to help with something else — a recipe, a plan for the day, or a list. ❤️", cards: [], refused: true };
          }
          const content = (resp.content || []).filter((b) => b.type !== "text" || b.text);
          api.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "…" }] });
          const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
          if (text) {
            texts.push(text);
            onProgress && onProgress(texts.join("\n\n"), cards);
          }
          const calls = content.filter((b) => b.type === "tool_use");
          if (resp.stop_reason !== "tool_use" || !calls.length) {
            if (resp.stop_reason === "max_tokens" && !text) texts.push("I got a little carried away there and ran out of room. Want me to keep going?");
            break;
          }
          const results = [];
          for (const call of calls) {
            let out;
            try {
              out = GA.Actions.run(call.name, call.input || {}, extra);
            } catch (e) {
              out = { error: e.message || "That didn't work." };
            }
            if (out.card) cards.push(out.card);
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: JSON.stringify(out.error ? { error: out.error } : out.result || { ok: true }),
              ...(out.error ? { is_error: true } : {}),
            });
          }
          onProgress && onProgress(texts.join("\n\n"), cards);
          api.push({ role: "user", content: results });
          if (round === MAX_TOOL_ROUNDS - 1) texts.push("All done — take a look above. ❤️");
        }
      } catch (e) {
        // Leave the history valid for the next attempt; actions already taken stay.
        api.length = startLen;
        e.cards = cards;
        throw e;
      }
      return { text: texts.join("\n\n"), cards };
    },

    /* Single-purpose structured request (e.g. reading a handwritten recipe). */
    async extract({ instruction, images = [], tool }) {
      if (AI.mode() === "ollama") {
        return GA.Ollama.json({ instruction, images, schema: tool.input_schema, system: TRANSCRIBER });
      }
      const content = images.map((b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
      content.push({ type: "text", text: instruction + `\n\nRespond by calling the ${tool.name} tool.` });
      const resp = await AI.request({
        system: [{ type: "text", text: TRANSCRIBER }],
        messages: [{ role: "user", content }],
        tools: [tool],
        maxTokens: 6000,
        purpose: "extract",
      });
      if (resp.stop_reason === "refusal") throw new AIError("server", "refused");
      const call = (resp.content || []).find((b) => b.type === "tool_use" && b.name === tool.name);
      if (!call) throw new AIError("server", "No structured result");
      return call.input;
    },
  };

  GA.AI = AI;
})();
