/*
 * Grandma AI — Grandma's brain, running entirely inside the web page.
 *
 * Two engines, same answers:
 *  - WebLLM (vendor/web-llm, Apache-2.0) runs the model on the graphics chip
 *    through WebGPU — fast, for computers and newer phones.
 *  - wllama (vendor/wllama, MIT — llama.cpp compiled to WebAssembly) runs a
 *    small model on the processor. It needs nothing special from the browser,
 *    so it works on every iPhone, iPad, and Android phone.
 * Nothing to install and no API key: the browser downloads the model once from
 * Hugging Face, keeps it in its cache, and from then on Grandma works offline
 * and privately — conversations never leave the device.
 *
 * Small on-device models are best at one clear job at a time, so Grandma
 * answers in a strict JSON shape — { actions: [...], reply: "..." } — that the
 * engine enforces while it writes. The actions run through the same tool
 * handlers (js/actions.js) that power every card in the app.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const HF = "https://huggingface.co";
  const MODELS = [
    { key: "3b", engine: "gpu", base: "Qwen2.5-3B-Instruct", label: "Recommended", size: "about 2 GB", note: "The best balance for most laptops and desktops." },
    { key: "1.5b", engine: "gpu", base: "Qwen2.5-1.5B-Instruct", label: "Lighter", size: "about 1 GB", note: "For newer phones, tablets, and older computers." },
    { key: "7b", engine: "gpu", base: "Qwen2.5-7B-Instruct", label: "Smartest", size: "about 4.5 GB", note: "Needs a computer with a strong graphics card." },
    // Processor-only models: work on any iPhone, iPad, or Android phone.
    { key: "phone", engine: "cpu", url: `${HF}/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf`, label: "Phone", size: "about 500 MB", note: "Works on any iPhone, iPad, or Android phone. Quick to download; simpler answers." },
    { key: "phone-plus", engine: "cpu", url: `${HF}/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`, label: "Phone+", size: "about 1.1 GB", note: "Smarter, for newer iPhones and iPads and most computers. A little slower." },
  ];
  const modelFor = (key) => MODELS.find((m) => m.key === key) || MODELS[0];
  const isMobile = () => /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const MAX_OUTPUT = 1100;
  // Processor models read more slowly, so they get a shorter conversation.
  const budget = () => (backend && backend.kind === "cpu" ? { history: 2000, context: 1400, ctx: 4096 } : { history: 4200, context: 2400 });

  const cfg = () => ({ model: "3b", ready: false, ...(Store.doc("local").brain || {}) });
  const save = (patch) => Store.setDoc("local", { brain: { ...cfg(), ...patch } });

  let libP = null;
  let cpuLibP = null;
  let gpu = null;
  let backend = null; // { kind, id, complete(opts), stop(), unload() }
  let loading = null;
  const status = { state: "idle", progress: 0, text: "" }; // idle | loading | ready | error
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(status); } catch (e) { /* ignore */ } });

  const asset = (path) => new URL(path, document.baseURI).href;
  const lib = () => (libP = libP || import(asset("vendor/web-llm/index.js")));
  const cpuLib = () => (cpuLibP = cpuLibP || import(asset("vendor/wllama/index.js")));

  /* A wllama instance that uses only files from this site (no CDN). Safari and
     older browsers need the "compat" build, which wllama picks automatically. */
  async function newWllama() {
    const { Wllama } = await cpuLib();
    const quiet = { debug() {}, log() {}, warn() {}, error: console.error.bind(console) };
    const wl = new Wllama({ default: asset("vendor/wllama/wllama.wasm") }, { allowOffline: true, suppressNativeLog: true, logger: quiet });
    wl.setCompat({ worker: asset("vendor/wllama/compat/wllama.js"), wasm: asset("vendor/wllama/compat/wllama.wasm") });
    return wl;
  }

  /* ---------------- device support ---------------- */
  async function support() {
    if (gpu) return gpu;
    if (!("gpu" in navigator)) return (gpu = { ok: false });
    try {
      const adapter = await navigator.gpu.requestAdapter();
      gpu = adapter ? { ok: true, f16: adapter.features.has("shader-f16") } : { ok: false };
    } catch (e) {
      gpu = { ok: false };
    }
    return gpu;
  }

  /* The model to use, respecting plan perks and what this device can run. */
  async function pick(key) {
    let k = key || cfg().model;
    if (k === "7b" && !GA.Plans.can("bigBrain")) k = "3b"; // Smartest is a Grandma Pro perk
    let m = modelFor(k);
    if (m.engine === "gpu" && !(await support()).ok) m = modelFor("phone"); // no WebGPU → processor model
    return m;
  }

  async function modelId(key) {
    const m = await pick(key);
    if (m.engine === "cpu") return m.url;
    return `${m.base}-${(await support()).f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
  }

  async function isDownloaded(key) {
    try {
      const m = modelFor(key);
      if (m.engine === "cpu") {
        const wl = await newWllama();
        return (await wl.cacheManager.list()).some((e) => e.metadata && e.metadata.originalURL === m.url);
      }
      if (!(await support()).ok) return false;
      return await (await lib()).hasModelInCache(await modelId(key));
    } catch (e) {
      return false;
    }
  }

  /* ---- engine: graphics chip (WebLLM + WebGPU) ---- */
  async function startGPU(id, report) {
    const webllm = await lib();
    const worker = new Worker(asset("js/brain-worker.js"), { type: "module" });
    try {
      const eng = await webllm.CreateWebWorkerMLCEngine(worker, id, {
        initProgressCallback: (r) => report(r.progress || 0, friendlyProgress(r.text)),
      });
      return {
        kind: "gpu",
        id,
        async complete({ messages, temperature, max_tokens, schema }) {
          const res = await eng.chat.completions.create({ messages, temperature, max_tokens, response_format: { type: "json_object", schema: JSON.stringify(schema) } });
          return { text: res.choices[0].message.content || "", finish: res.choices[0].finish_reason };
        },
        stop() { try { eng.interruptGenerate(); } catch (e) { /* ignore */ } },
        async unload() {
          try { await eng.unload(); } catch (e) { /* ignore */ }
          worker.terminate();
        },
      };
    } catch (e) {
      worker.terminate();
      throw e;
    }
  }

  /* ---- engine: processor (wllama, llama.cpp in WebAssembly) — any phone ---- */
  async function startCPU(m, report) {
    const wl = await newWllama();
    let downloaded = false;
    await wl.loadModelFromUrl(m.url, {
      n_ctx: 4096,
      n_gpu_layers: 0,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? loaded / total : 0;
        downloaded = pct >= 1;
        report(pct * 0.95, downloaded ? "Loading Grandma from this device…" : `Downloading Grandma — ${Math.round(pct * 100)}% (${Math.round(loaded / 1048576)} MB)`);
      },
    });
    let ctl = null;
    return {
      kind: "cpu",
      id: m.url,
      async complete({ messages, temperature, max_tokens, schema }) {
        ctl = new AbortController();
        try {
          const res = await wl.createChatCompletion({
            messages,
            temperature,
            max_tokens,
            cache_prompt: true, // reuse the unchanged start of the prompt between turns
            abortSignal: ctl.signal,
            response_format: { type: "json_schema", json_schema: { name: "answer", schema } },
          });
          return { text: res.choices[0].message.content || "", finish: res.choices[0].finish_reason };
        } finally {
          ctl = null;
        }
      },
      stop() { if (ctl) ctl.abort(); },
      async unload() { try { await wl.exit(); } catch (e) { /* ignore */ } },
    };
  }

  /* Start (or reuse) the engine. Loads from the browser cache after the first download. */
  async function load(onProgress) {
    const m = await pick();
    const id = await modelId(m.key);
    if (backend && backend.id === id) return backend;
    if (loading) return loading;
    loading = (async () => {
      if (backend) await unload();
      status.state = "loading";
      status.progress = 0;
      status.text = "";
      emit();
      const report = (progress, text) => {
        status.progress = progress;
        status.text = text;
        emit();
        onProgress && onProgress({ progress, text });
      };
      try {
        backend = m.engine === "cpu" ? await startCPU(m, report) : await startGPU(id, report);
        status.state = "ready";
        status.progress = 1;
        emit();
        return backend;
      } catch (e) {
        backend = null;
        status.state = "error";
        status.text = String((e && e.message) || e);
        emit();
        throw new GA.AI.AIError("brain-load", status.text);
      }
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  async function unload() {
    const b = backend;
    backend = null;
    if (b) await b.unload();
    status.state = "idle";
    emit();
  }

  /* ---------------- reading text in photos (OCR, in the browser) ---------------- */
  const ocrCache = new Map();
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load the photo reader."));
      document.head.appendChild(s);
    });

  async function ocr(base64) {
    const key = base64.length + ":" + base64.slice(0, 64) + base64.slice(-64);
    if (ocrCache.has(key)) return ocrCache.get(key);
    if (!window.Tesseract) await loadScript(TESSERACT_CDN);
    const blob = await (await fetch("data:image/jpeg;base64," + base64)).blob();
    const w = await window.Tesseract.createWorker("eng");
    try {
      const { data } = await w.recognize(blob);
      const text = String(data.text || "").replace(/\n{3,}/g, "\n\n").trim();
      ocrCache.set(key, text);
      return text;
    } finally {
      await w.terminate();
    }
  }

  /* ---------------- prompt ---------------- */
  const LOCAL_PROMPT = `You are Grandma AI: an AI assistant with a warm, practical, funny grandmotherly personality. You help with cooking, chores, planning the day, groceries, reminders, family recipes, and encouragement. You are an AI — not a human and not anyone's real grandmother.

Always answer with JSON: {"actions": [...], "reply": "..."}
- "reply": what you say. Short, warm, natural (1-4 sentences; light markdown is fine). Use "sweetheart" only now and then.
- "actions": things to do in the app right now, each {"name": "...", "arguments": {...}}. Use [] when nothing needs doing.
- When they ask you to add, remind, plan, make a list, save, or remember something, include the matching action. Never say you did something without the action.
- The app shows a card for every action, so don't repeat whole recipes or lists in "reply".
- Suggesting a specific dish → create_recipe with the dish name (the app writes out the full recipe). If you don't know what ingredients they have yet, ask first.
- A messy house or a big job → add_tasks with 3-5 small tasks for one area.
- Dates are YYYY-MM-DD (work them out from today's date below); times are HH:MM (24-hour). "Remind me" → remind: true.
- Use ids from the context to update, complete, or scale existing things. Respect remembered dislikes and allergies, and say when you left something out.
- remember only lasting, non-sensitive preferences.
Safety: you are not a doctor, therapist, lawyer, or financial advisor — give general information and suggest a qualified professional for those questions. If someone may be in crisis, be kind and point them to 988 (US) or local emergency help. Never suggest mixing bleach with ammonia or acids.`;

  const sig = (s) => {
    if (!s) return "any";
    if (s.enum) return s.enum.join("|");
    if (s.type === "array") return `[${sig(s.items)}]`;
    if (s.type === "object") {
      const req = s.required || [];
      return `{${Object.entries(s.properties || {}).map(([k, v]) => `${k}${req.includes(k) ? "" : "?"}: ${sig(v)}`).join(", ")}}`;
    }
    return s.type === "integer" ? "number" : s.type || "any";
  };
  // Recipes are written in a second, dedicated step with a strict schema, so
  // the first step only has to pick the dish.
  const LOCAL_DOCS = {
    create_recipe: "- create_recipe {name: string, notes?: string, servings?: number} — Suggest one specific dish; the app writes out the full recipe card.",
  };
  const toolDocs = (tools) => tools.map((t) => LOCAL_DOCS[t.name] || `- ${t.name} ${sig(t.input_schema)} — ${t.description.split(". ")[0]}.`).join("\n");

  const SECTIONS = ["produce", "meat", "dairy", "pantry", "other"];
  const RECIPE_SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      emoji: { type: "string" },
      servings: { type: "integer" },
      prep_minutes: { type: "integer" },
      cook_minutes: { type: "integer" },
      difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
      categories: { type: "array", items: { type: "string", enum: ["Breakfast", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"] } },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: { qty: { type: "number" }, unit: { type: "string" }, item: { type: "string" }, section: { type: "string", enum: SECTIONS } },
          required: ["qty", "unit", "item", "section"],
        },
      },
      steps: { type: "array", items: { type: "string" } },
      tips: { type: "array", items: { type: "string" } },
    },
    required: ["name", "description", "emoji", "servings", "prep_minutes", "cook_minutes", "difficulty", "categories", "ingredients", "steps", "tips"],
  };

  /* Write one full recipe with the engine enforcing the recipe shape. */
  async function recipe({ request, prefs, servings }) {
    const eng = await load();
    const res = await eng.complete({
      messages: [
        { role: "system", content: GA.AI.RECIPE_WRITER + ' Use qty 0 and unit "" for "to taste". Pick one food emoji.' },
        { role: "user", content: `Write a recipe for: ${request}\nServings: ${servings || 4}${prefs ? "\nAbout this cook:\n" + prefs : ""}` },
      ],
      temperature: 0.6,
      max_tokens: 1500,
      schema: RECIPE_SCHEMA,
    });
    return parseJSON(res.text);
  }

  const RECIPE_INTENT = /\brecipes?\b|what('?s| is| should i (make|cook)).{0,12}(dinner|lunch|breakfast|supper|dessert)|\b(make|cook|bake)\b.{0,20}\b(dinner|lunch|breakfast|supper|dessert)\b(?!.{0,20}\b(list|plan)\b)|\bi (have|'ve got|got)\b.{0,80}\b(chicken|beef|pork|rice|pasta|eggs?|potato(es)?|beans|fish|salmon|shrimp|tofu|cheese|broccoli|ground|turkey|sausage|noodles|flour|apples?|bananas?)\b/i;

  const responseSchema = (tools) => ({
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string", enum: tools.map((t) => t.name) }, arguments: { type: "object" } },
            required: ["name", "arguments"],
          },
        },
        reply: { type: "string" },
      },
      required: ["actions", "reply"],
  });

  /* Grandma's stored conversation → short chat for a small model. */
  async function toMessages(system, messages, tools) {
    const tone = ((system[0] && system[0].text) || "").match(/Tone for this person:[^\n]*/);
    const { history, context: contextChars } = budget();
    const context = ((system[1] && system[1].text) || "").slice(0, contextChars);
    const sys = [LOCAL_PROMPT, tone ? tone[0] : "", tools.length ? "Actions you can use:\n" + toolDocs(tools) : "Answer with actions: [] this time.", context].filter(Boolean).join("\n\n");

    const lastUser = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
    const out = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (m.role === "assistant") {
        const said = m.content.filter((b) => b.type === "text" && b.text !== "…").map((b) => b.text).join("\n");
        const did = m.content.filter((b) => b.type === "tool_use").map((b) => b.name);
        text = JSON.stringify({ actions: did.map((n) => ({ name: n, arguments: {} })), reply: said });
      } else {
        if (m.content.every((b) => b.type === "tool_result")) continue;
        const parts = [];
        for (const b of m.content) {
          if (b.type === "text") parts.push(b.text);
          else if (b.type === "image") {
            if (i === lastUser) {
              let read = "";
              try { read = await ocr(b.source.data); } catch (e) { /* photo reader unavailable */ }
              parts.push(read ? `[They shared a photo. Text read from it:\n${read.slice(0, 1200)}]` : "[They shared a photo. You can't see pictures, only read text in them, and none was found — ask them to describe it.]");
            } else parts.push("[They shared a photo earlier.]");
          }
        }
        text = parts.join("\n");
      }
      if (!text.trim()) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      const prev = out[out.length - 1];
      if (prev && prev.role === role) prev.content += "\n\n" + text;
      else out.push({ role, content: text });
    }
    // Keep the most recent turns that fit.
    let used = 0;
    let start = out.length;
    while (start > 0 && used + out[start - 1].content.length < history) used += out[--start].content.length;
    let recent = out.slice(Math.min(start, out.length - 1));
    while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
    return [{ role: "system", content: sys }, ...recent];
  }

  const parseJSON = (s) => {
    try {
      return JSON.parse(s);
    } catch (e) {
      const m = String(s).match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch (e2) { /* fall through */ }
      return null;
    }
  };

  /* One turn. Returns the same shape as the hosted API so js/ai.js's loop works unchanged. */
  async function chat({ system, messages, tools, signal }) {
    tools = tools || [];
    const last = messages[messages.length - 1];
    // Grandma already wrote her reply alongside the actions; after they run we
    // only mention anything that didn't work.
    if (last && Array.isArray(last.content) && last.content.length && last.content.every((b) => b.type === "tool_result")) {
      const failed = last.content.filter((b) => b.is_error).map((b) => (parseJSON(b.content) || {}).error).filter(Boolean);
      return { content: failed.length ? [{ type: "text", text: `Hmm, one thing didn't go through: ${failed[0]}` }] : [], stop_reason: "end_turn" };
    }
    const eng = await load();
    const msgs = await toMessages(system, messages, tools);
    const onAbort = () => eng.stop();
    if (signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let raw;
    try {
      const res = await eng.complete({
        messages: msgs,
        temperature: 0.5,
        max_tokens: MAX_OUTPUT,
        schema: responseSchema(tools.length ? tools : [{ name: "none" }]),
      });
      raw = res.text;
      var finish = res.finish;
    } catch (e) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw new GA.AI.AIError("brain", String((e && e.message) || e));
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");

    const j = parseJSON(raw);
    if (!j) {
      const text = raw.replace(/[{}"]/g, "").trim();
      return { content: text ? [{ type: "text", text }] : [], stop_reason: finish === "length" ? "max_tokens" : "end_turn" };
    }
    const names = new Set(tools.map((t) => t.name));
    const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a) => a && names.has(a.name));

    // They clearly asked for a recipe but the model only talked about it.
    const userText = typeof last.content === "string" ? last.content : (last.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    if (names.has("create_recipe") && RECIPE_INTENT.test(userText) && !actions.some((a) => a.name === "create_recipe") && !/\?\s*$/.test(String(j.reply || "").trim())) {
      actions.push({ name: "create_recipe", arguments: { name: "", notes: userText } });
    }
    // Write each suggested dish out as a full recipe (strict shape).
    for (const a of actions) {
      if (a.name !== "create_recipe" || GA.Kitchen.normalize(a.arguments) || GA.Plans.recipeGensLeft() <= 0) continue;
      const args = a.arguments || {};
      const request = [args.name, args.notes, `(They said: "${userText.slice(0, 300)}")`].filter(Boolean).join(". ");
      try {
        const full = await recipe({ request, prefs: GA.Kitchen.prefs(), servings: args.servings || GA.Kitchen.defaultServings() });
        if (full) a.arguments = full;
      } catch (e) { /* the handler reports the problem */ }
    }
    const content = [];
    if (j.reply && String(j.reply).trim()) content.push({ type: "text", text: String(j.reply).trim() });
    actions.forEach((a, i) => content.push({ type: "tool_use", id: `act_${Date.now().toString(36)}_${i}`, name: a.name, input: a.arguments || {} }));
    return { content, stop_reason: actions.length ? "tool_use" : "end_turn" };
  }

  /* Structured output — e.g. organizing a photographed family recipe. */
  async function json({ instruction, images = [], schema, system }) {
    let text = "";
    for (const b64 of images) {
      try { text += (await ocr(b64)) + "\n\n"; } catch (e) { throw new GA.AI.AIError("brain", "Couldn't load the photo reader."); }
    }
    if (images.length && text.trim().length < 12) return { legible: false, title: "", ingredients: [], instructions: [] };
    const eng = await load();
    const res = await eng.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${instruction}\n\nText read from the photo (it may contain reading mistakes; fix obvious ones only):\n${text.slice(0, 5000)}` },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      schema,
    });
    const out = parseJSON(res.text);
    if (!out) throw new GA.AI.AIError("brain", "Couldn't organize the recipe.");
    return out;
  }

  /* ================= "Turn on Grandma" setup ================= */
  function openSetup({ onDone } = {}) {
    const state = { step: "choose", model: cfg().model === "7b" && !GA.Plans.can("bigBrain") ? "3b" : cfg().model, downloaded: {}, support: null, progress: null, error: "", showAll: false };

    U.openSheet({
      title: "Turn on Grandma",
      wide: true,
      body: `<div class="setup" data-brain-setup-root></div>`,
      onMount(sheet, close) {
        const root = sheet.querySelector("[data-brain-setup-root]");

        function view() {
          let html = `<div class="setup-hero">${U.avatar(56)}<div><h3>Grandma's brain lives right here in your browser</h3>
            <p class="muted">Nothing to install and no account. Your browser downloads her once, keeps her, and after that she even works offline. Your conversations never leave this device.</p></div></div>`;
          if (!state.support) {
            html += `<div class="setup-card"><p class="muted waiting">${U.icon("refresh", "spin")} Checking this device…</p></div>`;
          } else if (state.step === "done") {
            html += `<div class="setup-card center">${U.avatar(72)}<h3>Grandma is ready ❤️</h3><p class="muted">She's running right inside this browser. Ask her what's for dinner.</p>
              <button class="btn primary" data-finish>Start chatting</button></div>`;
          } else {
            const opt = (m) => {
              const locked = m.key === "7b" && !GA.Plans.can("bigBrain");
              return `<label class="choice ${state.model === m.key ? "on" : ""} ${locked ? "locked" : ""}"><input type="radio" name="model" value="${m.key}" ${state.model === m.key ? "checked" : ""} ${state.progress || locked ? "disabled" : ""}>
                <span class="grow"><b>${m.label}</b> <span class="muted">· ${m.size}</span><small>${m.note}</small></span>${locked ? `<span class="tag-pro">Pro</span>` : state.downloaded[m.key] ? `<span class="tag ok">Downloaded</span>` : ""}</label>`;
            };
            const ready = state.downloaded[state.model];
            const gpuOk = state.support.ok;
            const gpuModels = MODELS.filter((m) => m.engine === "gpu");
            const cpuModels = MODELS.filter((m) => m.engine === "cpu");
            const list = gpuOk ? (state.showAll || modelFor(state.model).engine === "cpu" ? [...gpuModels, ...cpuModels] : gpuModels) : cpuModels;
            html += `<div class="setup-card"><p><b>Choose Grandma's brain.</b> ${ready ? "It's already on this device." : "It's a one-time download — Wi-Fi is best."}</p>
              ${gpuOk ? "" : `<p class="muted small">This device will run Grandma on its processor, so it works on any iPhone, iPad, or Android phone. Replies take a little longer to start than on a computer.</p>`}
              <div class="choices">${list.map(opt).join("")}</div>
              ${gpuOk && list.length === gpuModels.length && !state.progress ? `<button class="btn ghost small" data-show-all>Trouble on this device? Show the works-anywhere versions</button>` : ""}
              ${state.progress ? `<div class="progress"><i style="width:${Math.round(state.progress.pct * 100)}%"></i></div><p class="muted small" data-progress-text>${U.esc(state.progress.text)}</p>` : ""}
              ${state.error ? `<p class="form-error">${U.esc(state.error)}</p>` : ""}
              <div class="row wrap">${state.progress ? "" : `<button class="btn primary" data-download>${U.icon(ready ? "sparkle" : "download")}${ready ? "Turn on Grandma" : "Download Grandma"}</button>`}</div>
              <p class="muted small">Tip: keep this tab open until it finishes. Closing it just pauses the download.</p></div>`;
          }
          root.innerHTML = html;
        }

        async function start() {
          state.error = "";
          save({ model: state.model });
          state.progress = { pct: 0, text: "Starting…" };
          view();
          try {
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
            await unload();
            await load((r) => {
              state.progress = { pct: r.progress || 0, text: r.text };
              const bar = root.querySelector(".progress i");
              const txt = root.querySelector("[data-progress-text]");
              if (bar) bar.style.width = Math.round((r.progress || 0) * 100) + "%";
              if (txt) txt.textContent = state.progress.text;
            });
            save({ model: state.model, ready: true });
            state.progress = null;
            state.step = "done";
          } catch (e) {
            state.progress = null;
            const m = modelFor(state.model);
            if (/memory|OOM|device lost|allocate|Aborted\(\)|RangeError/i.test(e.message)) {
              // Too big for this device: step down to something that fits.
              const smaller = m.key === "7b" ? "3b" : m.key === "3b" ? "1.5b" : m.key === "1.5b" || m.key === "phone-plus" ? "phone" : "";
              state.error = smaller
                ? `This device ran out of memory for that one. I picked “${modelFor(smaller).label}” instead — tap the button to try it.`
                : "This device ran out of memory. Close other apps and tabs, then try again.";
              if (smaller) {
                state.model = smaller;
                state.showAll = true;
              }
            } else {
              state.error = `That didn't finish: ${e.message}. Check your internet connection and try again — it picks up where it left off.`;
            }
          }
          view();
          GA.App && GA.App.refreshAll();
        }

        root.addEventListener("click", (e) => {
          if (e.target.closest("[data-download]")) return start();
          if (e.target.closest("[data-show-all]")) {
            state.showAll = true;
            return view();
          }
          if (e.target.closest("[data-finish]")) {
            close();
            onDone && onDone();
          }
        });
        root.addEventListener("change", (e) => {
          if (e.target.name === "model") {
            state.model = e.target.value;
            view();
          }
        });

        view();
        support().then(async (s) => {
          state.support = s;
          const chosen = modelFor(state.model);
          if (!s.ok && chosen.engine === "gpu") state.model = "phone";
          else if (s.ok && !cfg().ready && chosen.key === "3b" && isMobile()) state.model = "1.5b"; // phones: start lighter
          view();
          for (const m of MODELS) state.downloaded[m.key] = await isDownloaded(m.key);
          view();
        });
      },
    });
  }

  function friendlyProgress(text) {
    const t = String(text || "");
    const pct = t.match(/(\d+)% completed/);
    const mb = t.match(/(\d+)MB (?:fetched|loaded)/);
    if (/cache/i.test(t) && /Loading model from cache/i.test(t)) return "Loading Grandma from this device…";
    if (pct || mb) return `Downloading Grandma${pct ? ` — ${pct[1]}%` : ""}${mb ? ` (${mb[1]} MB)` : ""}`;
    if (/shader|GPU/i.test(t)) return "Getting your graphics chip ready…";
    return t.length > 90 ? t.slice(0, 90) + "…" : t || "Working…";
  }

  /* Warm up in the background so the first message is quick. */
  function preload() {
    if (!cfg().ready || backend || loading) return;
    load().catch(() => {});
  }

  GA.Brain = {
    MODELS,
    cfg,
    save,
    support,
    isDownloaded,
    load,
    unload,
    preload,
    chat,
    json,
    recipe,
    ocr,
    openSetup,
    engine: () => (backend ? backend.kind : ""),
    status: () => status,
    onStatus: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    async forget() {
      await unload();
      try {
        if ((await support()).ok) {
          const webllm = await lib();
          for (const m of MODELS.filter((x) => x.engine === "gpu")) await webllm.deleteModelAllInfoInCache(await modelId(m.key)).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      try {
        await (await newWllama()).cacheManager.clear();
      } catch (e) { /* ignore */ }
      save({ ready: false });
    },
  };
})();
