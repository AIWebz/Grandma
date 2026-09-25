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
  // How long Grandma may go quiet before we call her stuck (milliseconds).
  const TIMEOUTS = { gpuFirst: 90000, gpuGap: 30000, cpuFirst: 240000, cpuGap: 60000 };
  // Processor models read more slowly, so they get a shorter conversation.
  const budget = (tight) =>
    tight ? { history: 0, context: 500 } : backend && backend.kind === "cpu" ? { history: 1200, context: 1000 } : { history: 4200, context: 2400 };
  const maxOutput = () => (backend && backend.kind === "cpu" ? 300 : MAX_OUTPUT);

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
      // Some browsers never answer this; treat a slow answer as "no graphics chip".
      const adapter = await Promise.race([navigator.gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 4000))]);
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
        async complete({ messages, temperature, max_tokens, schema, onDelta }) {
          const stream = await eng.chat.completions.create({ messages, temperature, max_tokens, stream: true, response_format: { type: "json_object", schema: JSON.stringify(schema) } });
          let text = "";
          let finish = "";
          for await (const chunk of stream) {
            const c = chunk.choices && chunk.choices[0];
            if (!c) continue;
            if (c.delta && c.delta.content) text += c.delta.content;
            if (c.finish_reason) finish = c.finish_reason;
            onDelta(text);
          }
          return { text, finish };
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
  /* How many processor cores to use. More cores need a cross-origin isolated page (see sw.js). */
  function cpuThreads() {
    if (!self.crossOriginIsolated) return 1;
    const cores = navigator.hardwareConcurrency || 4;
    // Phones: up to 4 (some report only 2 cores to websites); computers: all but one, up to 8.
    return isMobile() ? Math.min(4, Math.max(2, cores - 1)) : Math.max(1, Math.min(8, cores - 1));
  }

  async function startCPU(m, report) {
    const opts = (threads) => ({
      n_ctx: 2048, // Phone prompts are short; a smaller window saves memory
      n_batch: 512,
      n_gpu_layers: 0,
      n_threads: threads,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? loaded / total : 0;
        report(pct * 0.95, pct >= 1 ? "Loading Grandma from this device…" : `Downloading Grandma — ${Math.round(pct * 100)}% (${Math.round(loaded / 1048576)} MB)`);
      },
    });
    let wl = await newWllama();
    const threads = cpuThreads();
    try {
      await wl.loadModelFromUrl(m.url, opts(threads));
    } catch (e) {
      if (threads <= 1) throw e;
      // Some browsers can't run the multi-core build; fall back to one core.
      try { await wl.exit(); } catch (e2) { /* ignore */ }
      wl = await newWllama();
      await wl.loadModelFromUrl(m.url, opts(1));
    }
    let ctl = null;
    return {
      kind: "cpu",
      id: m.url,
      async complete({ messages, temperature, max_tokens, schema, grammar, onDelta }) {
        ctl = new AbortController();
        try {
          const stream = await wl.createChatCompletion({
            messages,
            temperature,
            max_tokens,
            stream: true,
            cache_prompt: true, // reuse the unchanged start of the prompt between turns
            abortSignal: ctl.signal,
            grammar: grammar || schemaGrammar(schema), // exact answer shape, no stray whitespace
          });
          let text = "";
          let finish = "";
          for await (const chunk of stream) {
            const c = chunk.choices && chunk.choices[0];
            if (!c) continue;
            if (c.delta && c.delta.content) text += c.delta.content;
            if (c.finish_reason) finish = c.finish_reason;
            onDelta(text);
          }
          return { text, finish };
        } finally {
          ctl = null;
        }
      },
      stop() { if (ctl) ctl.abort(); },
      async unload() { try { await wl.exit(); } catch (e) { /* ignore */ } },
    };
  }

  /*
   * Run one request on the engine, streaming. Never hangs: if the engine goes
   * quiet for too long (a phone that's too slow, or a crashed engine), it is
   * stopped and restarted next time, and the person gets a clear message.
   */
  let lane = Promise.resolve(); // one request at a time (the warm-up may be running)
  function generate(opts, how = {}) {
    const run = lane.then(() => generateNow(opts, how));
    lane = run.catch(() => {});
    if (!how.signal) return run;
    return Promise.race([
      run,
      new Promise((_, reject) => {
        const stop = () => reject(new DOMException("Aborted", "AbortError"));
        if (how.signal.aborted) stop();
        else how.signal.addEventListener("abort", stop, { once: true });
      }),
    ]);
  }

  async function generateNow(opts, { signal, onDelta } = {}) {
    const eng = await load();
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const cpu = eng.kind === "cpu";
    const FIRST = cpu ? TIMEOUTS.cpuFirst : TIMEOUTS.gpuFirst; // reading the prompt before the first word
    const GAP = cpu ? TIMEOUTS.cpuGap : TIMEOUTS.gpuGap; // between words
    let timer = null;
    let fail = null;
    const failed = new Promise((_, reject) => (fail = reject));
    failed.catch(() => {});
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        eng.stop();
        if (backend === eng) {
          backend = null; // start fresh next time
          eng.unload().catch(() => {});
          status.state = "idle";
          emit();
        }
        fail(new GA.AI.AIError("brain-stuck", "Grandma's brain stopped responding."));
      }, ms);
    };
    const onAbort = () => {
      eng.stop();
      fail(new DOMException("Aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    arm(FIRST);
    try {
      return await Promise.race([
        eng.complete({ ...opts, onDelta: (text) => { arm(GAP); onDelta && onDelta(text); } }),
        failed,
      ]);
    } catch (e) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (e instanceof GA.AI.AIError) throw e;
      throw new GA.AI.AIError(/context size|exceeds? the (available )?context|too long/i.test(String(e && e.message)) ? "brain-context" : "brain", String((e && e.message) || e));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /* What Grandma is busy with while someone waits (shown under the typing dots). */
  let activity = "";
  const setActivity = (t) => {
    activity = t;
    emit();
  };

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
        if (backend.kind === "cpu") warmUp(backend);
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
      s.crossOrigin = "anonymous";
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

Always answer with JSON: {"reply": "...", "actions": [...]}
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

  /* ================= Phone versions: short prompt, exact output rules =================
   * A phone's processor reads slowly, so the Phone brains get a much shorter
   * prompt, a handful of simple actions, and a grammar that allows exactly the
   * answer shape — no stray spaces, no invalid actions, nothing to wander into.
   */
  const PHONE_PROMPT = `You are Grandma AI, a warm, practical AI grandma (not a real person) who helps with cooking, chores, plans, groceries, and reminders.
Always answer with JSON: {"reply": "...", "actions": [...]}
"reply" is what you say to them, in your own words: 1-3 short, warm sentences.
"actions" are things to do in the app right now, or [] if none. Never say you did something without its action. Dates YYYY-MM-DD, times HH:MM (24h).
Not a doctor, lawyer, or therapist; in a crisis, point to 988 or local emergency help.`;
  // Worked examples: small models copy the pattern far better than they follow rules.
  const PHONE_EXAMPLES = [
    ["Hi Grandma!", { reply: "Well hello there, sweetheart! What can I help you with today?", actions: [] }],
    ["Add laundry and dishes to my chores", { reply: "Done! Laundry and dishes are on your list. One thing at a time, dear.", actions: [{ name: "add_tasks", arguments: { tasks: [{ title: "Do the laundry" }, { title: "Wash the dishes" }] } }] }],
    ["We need milk and eggs", { reply: "I put milk and eggs on your grocery list.", actions: [{ name: "add_grocery_items", arguments: { items: [{ name: "Milk" }, { name: "Eggs" }] } }] }],
  ];
  const phoneExamples = (toolNames) =>
    PHONE_EXAMPLES.filter(([, a]) => a.actions.every((x) => toolNames.includes(x.name))).flatMap(([q, a]) => [
      { role: "user", content: q },
      { role: "assistant", content: JSON.stringify(a) },
    ]);
  const T_STR = { type: "string" };
  const T_DATE = { type: "string", format: "date" };
  const T_TIME = { type: "string", format: "time" };
  const T_BOOL = { type: "boolean" };
  const obj = (properties, required) => ({ type: "object", properties, required });
  const PHONE_TOOLS = {
    add_tasks: {
      doc: 'add_tasks {"tasks":[{"title","due_date"?,"due_time"?,"remind"?}]} — to-dos and reminders',
      schema: obj({ tasks: { type: "array", maxItems: 6, items: obj({ title: T_STR, due_date: T_DATE, due_time: T_TIME, remind: T_BOOL }, ["title"]) } }, ["tasks"]),
    },
    update_tasks: {
      doc: 'update_tasks {"updates":[{"task_id","completed"}]} — mark tasks done',
      schema: obj({ updates: { type: "array", maxItems: 6, items: obj({ task_id: T_STR, completed: T_BOOL }, ["task_id"]) } }, ["updates"]),
    },
    add_grocery_items: {
      doc: 'add_grocery_items {"items":[{"name","quantity"?}]}',
      schema: obj({ items: { type: "array", maxItems: 12, items: obj({ name: T_STR, quantity: T_STR }, ["name"]) } }, ["items"]),
    },
    create_recipe: {
      doc: 'create_recipe {"name"} — suggest a dish; the app writes the recipe',
      schema: obj({ name: T_STR }, ["name"]),
    },
    add_recipe_to_grocery: {
      doc: 'add_recipe_to_grocery {"recipe_id"}',
      schema: obj({ recipe_id: T_STR }, ["recipe_id"]),
    },
    plan_day: {
      doc: 'plan_day {"date","items":[{"time","title"}]}',
      schema: obj({ date: T_DATE, items: { type: "array", maxItems: 10, items: obj({ time: T_TIME, title: T_STR }, ["time", "title"]) } }, ["date", "items"]),
    },
    remember: {
      doc: 'remember {"category","fact"} — lasting preferences only',
      schema: obj({ category: { type: "string", enum: ["name", "likes", "dislikes", "diet", "skill", "routine", "household", "style", "other"] }, fact: T_STR }, ["category", "fact"]),
    },
  };

  /* JSON schema → a compact GBNF grammar for llama.cpp (no optional whitespace). */
  const GRAMMAR_BASE = String.raw`value ::= object | array | string | number | boolean | "null"
object ::= "{" (string ":" value ("," string ":" value)*)? "}"
array ::= "[" (value ("," value)*)? "]"
string ::= "\"" char* "\""
char ::= [^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])
integer ::= "-"? ("0" | [1-9] [0-9]? [0-9]? [0-9]? [0-9]? [0-9]?)
number ::= integer ("." [0-9] [0-9]? [0-9]?)?
boolean ::= "true" | "false"
date ::= "\"" [0-9] [0-9] [0-9] [0-9] "-" [0-9] [0-9] "-" [0-9] [0-9] "\""
time ::= "\"" [0-9] [0-9] ":" [0-9] [0-9] "\""`;
  function grammarBuilder() {
    const rules = [];
    const lit = (str) => JSON.stringify(str);
    const rule = (body) => {
      const name = "g" + rules.length;
      rules.push(`${name} ::= ${body}`);
      return name;
    };
    const list = (item, max) => (max ? `(${item} ("," ${item}){0,${max - 1}})?` : `(${item} ("," ${item})*)?`);
    function expr(sc) {
      if (!sc) return "value";
      if (sc.enum) return "(" + sc.enum.map((v) => lit(JSON.stringify(v))).join(" | ") + ")";
      if (sc.format === "date") return "date";
      if (sc.format === "time") return "time";
      switch (sc.type) {
        case "string": return "string";
        case "integer": return "integer";
        case "number": return "number";
        case "boolean": return "boolean";
        case "array": return rule(`"[" ${list(expr(sc.items), sc.maxItems)} "]"`);
        case "object": {
          const props = Object.entries(sc.properties || {});
          if (!props.length) return "object";
          const req = sc.required && sc.required.length ? sc.required : [props[0][0]];
          const must = props.filter(([k]) => req.includes(k));
          const may = props.filter(([k]) => !req.includes(k));
          const pair = ([k, v]) => `${lit(JSON.stringify(k) + ":")} ${expr(v)}`;
          const body = must.map(pair).join(` "," `) + may.map((p) => ` ("," ${pair(p)})?`).join("");
          return rule(`"{" ${body} "}"`);
        }
        default: return "value";
      }
    }
    return { expr, lit, rule, build: (root) => `root ::= ${root}\n${rules.join("\n")}\n${GRAMMAR_BASE}` };
  }
  const schemaGrammar = (schema) => {
    const g = grammarBuilder();
    return g.build(g.expr(schema));
  };
  /* Grandma's chat answer: {"reply": "...", "actions": [ up to 4 of the allowed actions ]}. */
  const chatGrammar = (toolNames) => {
    const g = grammarBuilder();
    let actions = '"[]"';
    if (toolNames.length) {
      const one = g.rule(toolNames.map((n) => `${g.lit(`{"name":${JSON.stringify(n)},"arguments":`)} ${g.expr(PHONE_TOOLS[n].schema)} "}"`).join(" | "));
      actions = `"[" (${one} ("," ${one}){0,3})? "]"`;
    }
    return g.build(`${g.lit('{"reply":')} string ${g.lit(',"actions":')} ${actions} "}"`);
  };

  /* A few short lines about the app — only what this message is likely to need. */
  function phoneContext(system, text) {
    const now = new Date();
    const t = String(text || "").toLowerCase();
    const lines = [`Today: ${now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (${U.today()}).`];
    const name = Store.doc("profile").name;
    if (name) lines.push(`Their name: ${name}.`);
    if (Store.doc("settings").memoryEnabled) {
      const facts = Store.list("memory").map((m) => m.fact).slice(-6);
      if (facts.length) lines.push(`You remember: ${facts.join("; ").slice(0, 240)}.`);
    }
    if (/task|chore|to-?do|done|finish|complete|remind|clean/.test(t)) {
      const open = Store.allTasks().filter((x) => !x.completed).slice(0, 6);
      lines.push(open.length ? `Open tasks (id title): ${open.map((x) => `${x.id} ${x.title}`).join("; ")}.` : "No open tasks.");
    }
    if (/grocer|shopping|buy|store|list|need/.test(t)) {
      const g = Store.list("grocery").filter((x) => !x.checked).slice(0, 8).map((x) => x.name);
      lines.push(g.length ? `Grocery list: ${g.join(", ")}.` : "The grocery list is empty.");
    }
    const shown = ((system[1] && system[1].text) || "").match(/Recipes shown in this conversation[^:]*: ([^\n]*)/);
    if (shown && /recipe|ingredient|grocer|list|that|this|\bit\b/.test(t)) {
      lines.push(`Recipes shown above (id name): ${shown[1].split("; ").slice(-2).map((x) => x.split(" | ").slice(0, 2).join(" ")).join("; ")}.`);
    }
    return lines.join("\n");
  }

  /* On phones, a classic Grandma already knows beats a minute of writing. */
  function recipeBoxMatch(name) {
    const words = (x) => new Set((String(x).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !["and", "the", "with", "grandma", "easy", "classic", "homemade", "best", "simple", "recipe"].includes(w)).map((w) => w.replace(/s$/, "")));
    const want = words(name);
    if (!want.size) return null;
    const box = [...(window.GA_SEED_RECIPES || []), ...Store.list("recipes").filter((r) => r.saved)];
    let best = null;
    for (const r of box) {
      const have = words(r.name);
      const hit = [...want].filter((w) => have.has(w)).length;
      if (hit === want.size || (hit === have.size && hit >= 2)) {
        if (!best || hit > best.hit) best = { r, hit };
      }
    }
    return best ? best.r : null;
  }

  /* Read Grandma's (unchanging) instructions right after loading, so the first message only reads itself. */
  function warmUp(eng) {
    try {
      const tools = GA.AI.toolsFor().filter((t) => PHONE_TOOLS[t.name]);
      toMessages(GA.AI.systemPrompt({}), [{ role: "user", content: "Hi" }], tools, false, true)
        .then((messages) => generate({ messages, temperature: 0, max_tokens: 1, grammar: 'root ::= "{"' }))
        .catch(() => {});
    } catch (e) { /* warm-up is only a head start */ }
  }

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
      categories: { type: "array", items: { type: "string", enum: ["Breakfast", "Lunch", "Dinner", "Desserts", "Baking", "Comfort Food", "Southern", "Italian", "Mexican", "American Classics"] } },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: { qty: { type: "number" }, unit: { type: "string" }, item: { type: "string" }, section: { type: "string", enum: SECTIONS } },
          required: ["qty", "unit", "item", "section"],
        },
      },
      cuisine: { type: "string" },
      steps: {
        type: "array",
        items: { type: "object", properties: { text: { type: "string" }, minutes: { type: "integer" } }, required: ["text", "minutes"] },
      },
      tips: { type: "array", items: { type: "string" } },
    },
    required: ["name", "description", "emoji", "cuisine", "servings", "prep_minutes", "cook_minutes", "difficulty", "categories", "ingredients", "steps", "tips"],
  };
  // Phone versions write a slightly shorter recipe so it's ready sooner.
  const PHONE_RECIPE_SCHEMA = {
    ...RECIPE_SCHEMA,
    properties: {
      ...RECIPE_SCHEMA.properties,
      categories: { ...RECIPE_SCHEMA.properties.categories, maxItems: 2 },
      ingredients: { ...RECIPE_SCHEMA.properties.ingredients, maxItems: 10 },
      steps: { ...RECIPE_SCHEMA.properties.steps, maxItems: 6 },
      tips: { ...RECIPE_SCHEMA.properties.tips, maxItems: 1 },
    },
  };

  /* Write one full recipe with the engine enforcing the recipe shape. */
  async function recipe({ request, prefs, servings, signal }) {
    // Each step carries its minutes; see Kitchen.normalize.
    await load();
    const res = await generate({
      messages: [
        { role: "system", content: GA.AI.RECIPE_WRITER + ' Use qty 0 and unit "" for "to taste". Pick one food emoji.' },
        { role: "user", content: `Write a recipe for: ${request}\nServings: ${servings || 4}${prefs ? "\nAbout this cook:\n" + prefs : ""}` },
      ],
      temperature: 0.6,
      max_tokens: backend && backend.kind === "cpu" ? 650 : 1500,
      schema: backend && backend.kind === "cpu" ? PHONE_RECIPE_SCHEMA : RECIPE_SCHEMA,
    }, { signal });
    return parseJSON(res.text);
  }

  const RECIPE_INTENT = /\brecipes?\b|what('?s| is| should i (make|cook)).{0,12}(dinner|lunch|breakfast|supper|dessert)|\b(make|cook|bake)\b.{0,20}\b(dinner|lunch|breakfast|supper|dessert)\b(?!.{0,20}\b(list|plan)\b)|\bi (have|'ve got|got)\b.{0,80}\b(chicken|beef|pork|rice|pasta|eggs?|potato(es)?|beans|fish|salmon|shrimp|tofu|cheese|broccoli|ground|turkey|sausage|noodles|flour|apples?|bananas?)\b/i;

  const responseSchema = (tools) => ({
      type: "object",
      // "reply" comes first so her words can appear while she's still working.
      properties: {
        reply: { type: "string" },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string", enum: tools.map((t) => t.name) }, arguments: { type: "object" } },
            required: ["name", "arguments"],
          },
        },
      },
      required: ["reply", "actions"],
  });

  /* Grandma's stored conversation → short chat for a small model. */
  async function toMessages(system, messages, tools, tight, phone) {
    const tone = ((system[0] && system[0].text) || "").match(/Tone for this person:[^\n]*/);
    const { history, context: contextChars } = budget(tight);
    const rawContext = ((system[1] && system[1].text) || "").slice(0, contextChars);
    // Phone versions: the system prompt never changes, so the engine can reuse
    // its work from earlier messages; today's details ride along with the newest message.
    const sys = phone
      ? [PHONE_PROMPT, tone ? "Tone: " + tone[0].replace(/^Tone for this person:\s*/, "").split(".")[0] + "." : "", tools.length ? "Actions:\n" + tools.map((t) => "- " + PHONE_TOOLS[t.name].doc).join("\n") : "Use actions: [] this time."].filter(Boolean).join("\n\n")
      : [LOCAL_PROMPT, tone ? tone[0] : "", tools.length ? "Actions you can use:\n" + toolDocs(tools) : "Answer with actions: [] this time.", rawContext].filter(Boolean).join("\n\n");

    const lastUser = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
    const out = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (m.role === "assistant") {
        const said = m.content.filter((b) => b.type === "text" && b.text !== "…").map((b) => b.text).join("\n");
        const did = m.content.filter((b) => b.type === "tool_use").map((b) => b.name);
        text = JSON.stringify({ reply: phone ? said.slice(0, 200) : said, actions: did.map((n) => ({ name: n, arguments: {} })) });
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
    if (phone) {
      // Phone brains read slowly: send the newest message, plus the exchange
      // before it only when the message leans on it ("yes", "add that", …).
      let i = out.length - 1;
      while (i >= 0 && out[i].role !== "user") i--;
      const examples = phoneExamples(tools.map((t) => t.name));
      if (i < 0) return [{ role: "system", content: sys }, ...examples];
      const last = out[i];
      const leansOnEarlier = !tight && (last.content.length < 40 || /\b(it|that|this|those|them|yes|yeah|yep|sure|ok(ay)?|please|another|more|again|instead|same)\b/i.test(last.content));
      const before = leansOnEarlier ? out.slice(Math.max(0, i - 2), i) : [];
      const context = phoneContext(system, last.content);
      const msgs = [...before.map((m) => ({ ...m, content: m.role === "user" ? m.content.slice(0, 300) : m.content })), { role: "user", content: `(${context})\n\n${last.content}` }];
      while (msgs.length > 1 && msgs[0].role !== "user") msgs.shift();
      return [{ role: "system", content: sys }, ...examples, ...msgs];
    }
    // Keep the most recent turns that fit.
    let used = 0;
    let start = out.length;
    while (start > 0 && used + out[start - 1].content.length < history) used += out[--start].content.length;
    let recent = out.slice(Math.min(start, out.length - 1));
    while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
    return [{ role: "system", content: sys }, ...recent];
  }

  /* The "reply" text so far, from JSON that's still being written. */
  const partialReply = (raw) => {
    const m = String(raw || "").match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (!m) return "";
    const body = m[1].replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, "");
    try {
      return JSON.parse('"' + body + '"');
    } catch (e) {
      return "";
    }
  };

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
  async function chat({ system, messages, tools, signal, onText }) {
    tools = tools || [];
    const last = messages[messages.length - 1];
    // Grandma already wrote her reply alongside the actions; after they run we
    // only mention anything that didn't work.
    if (last && Array.isArray(last.content) && last.content.length && last.content.every((b) => b.type === "tool_result")) {
      const failed = last.content.filter((b) => b.is_error).map((b) => (parseJSON(b.content) || {}).error).filter(Boolean);
      return { content: failed.length ? [{ type: "text", text: `Hmm, one thing didn't go through: ${failed[0]}` }] : [], stop_reason: "end_turn" };
    }
    await load();
    const phone = backend && backend.kind === "cpu";
    if (phone) tools = tools.filter((t) => PHONE_TOOLS[t.name]);
    const schema = responseSchema(tools.length ? tools : [{ name: "none" }]);
    const grammar = phone ? chatGrammar(tools.map((t) => t.name)) : undefined;
    let shown = "";
    if (phone) setActivity("Grandma is reading your message — phones take a little longer…");
    const onDelta = (text) => {
      if (activity) setActivity("");
      const r = partialReply(text);
      if (r && r !== shown) {
        shown = r;
        onText && onText(r);
      }
    };
    const ask = async (tight) => generate({ messages: await toMessages(system, messages, tools, tight, phone), temperature: 0.5, max_tokens: maxOutput(), schema, grammar }, { signal, onDelta });
    let res;
    try {
      res = await ask(false);
    } catch (e) {
      if (e.kind !== "brain-context") throw e;
      res = await ask(true); // long conversation: try again with just the latest message
    } finally {
      if (activity) setActivity("");
    }
    const raw = res.text;
    const finish = res.finish;

    const j = parseJSON(raw);
    if (!j) {
      const text = partialReply(raw).trim();
      return { content: text ? [{ type: "text", text }] : [], stop_reason: finish === "length" ? "max_tokens" : "end_turn" };
    }
    const names = new Set(tools.map((t) => t.name));
    let actions = (Array.isArray(j.actions) ? j.actions : []).filter((a) => a && names.has(a.name));
    if (phone) {
      // Writing a recipe takes a phone a while: one dish per answer.
      let dishes = 0;
      actions = actions.filter((a) => a.name !== "create_recipe" || dishes++ === 0);
    }

    // They clearly asked for a recipe but the model only talked about it.
    const userText = typeof last.content === "string" ? last.content : (last.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    if (names.has("create_recipe") && RECIPE_INTENT.test(userText) && !actions.some((a) => a.name === "create_recipe") && !/\?\s*$/.test(String(j.reply || "").trim())) {
      actions.push({ name: "create_recipe", arguments: { name: "", notes: userText } });
    }
    // Write each suggested dish out as a full recipe (strict shape).
    for (const a of actions) {
      if (a.name !== "create_recipe" || GA.Plans.recipeGensLeft() <= 0) continue;
      // A time limit they asked for ("a 10 minute recipe") has to hold.
      const limit = GA.Kitchen.timeLimit(userText);
      const fits = (r) => !limit || GA.Kitchen.totalMinutes(r) <= limit + Math.max(2, Math.round(limit * 0.1));
      const already = GA.Kitchen.normalize(a.arguments);
      if (already && fits(already)) continue;
      const args = a.arguments || {};
      const known = phone && recipeBoxMatch(args.name || "");
      if (known && fits(known)) {
        a.arguments = { ...known, id: undefined, save: false };
        continue;
      }
      const request = [args.name, args.notes, `(They said: "${userText.slice(0, 300)}")`].filter(Boolean).join(". ");
      setActivity("Writing out the full recipe…");
      try {
        const full = await GA.AI.generateRecipe({ request, servings: args.servings || GA.Kitchen.defaultServings(), signal });
        if (full) a.arguments = full;
      } catch (e) {
        if (e.name === "AbortError" || e.kind === "brain-stuck") throw e;
        /* otherwise the handler reports the problem */
      } finally {
        setActivity("");
      }
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
    await load();
    const res = await generate({
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

  /* ---- multi-core for the Phone brains (see sw.js) ---- */
  const adsNeedThirdParty = () => ((window.GRANDMA_CONFIG || {}).ads || {}).provider === "adsense"; // ad frames can't load on isolated pages
  async function setIsolation(on) {
    if (adsNeedThirdParty()) on = false;
    try {
      const flags = await caches.open("ga-flags");
      if (on) await flags.put("coi", new Response("1"));
      else await flags.delete("coi");
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: "coi", on });
    } catch (e) { /* no Cache API: stays single-core */ }
    return on;
  }
  /* Reload once so the page picks up multi-core support. Guarded against loops. */
  async function reloadForIsolation() {
    if (self.crossOriginIsolated || !(navigator.serviceWorker && navigator.serviceWorker.controller)) return false;
    try {
      if (sessionStorage.getItem("ga-coi-reload")) return false;
      sessionStorage.setItem("ga-coi-reload", "1");
    } catch (e) {
      return false;
    }
    await Store.saveNow();
    location.reload();
    return true;
  }

  /* ================= "Turn on Grandma" setup ================= */
  function openSetup({ onDone, autoStart } = {}) {
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
            const gpuOkNow = state.support.ok;
            const opt = (m) => {
              const locked = m.key === "7b" && !GA.Plans.can("bigBrain");
              return `<label class="choice ${state.model === m.key ? "on" : ""} ${locked ? "locked" : ""}"><input type="radio" name="model" value="${m.key}" ${state.model === m.key ? "checked" : ""} ${state.progress || locked ? "disabled" : ""}>
                <span class="grow"><b>${m.label}</b> <span class="muted">· ${m.size}</span>${gpuOkNow && isMobile() && m.key === "1.5b" ? ` <span class="tag ok">Fastest here</span>` : ""}<small>${m.note}</small></span>${locked ? `<span class="tag-pro">Pro</span>` : state.downloaded[m.key] ? `<span class="tag ok">Downloaded</span>` : ""}</label>`;
            };
            const ready = state.downloaded[state.model];
            const gpuOk = state.support.ok;
            const gpuModels = MODELS.filter((m) => m.engine === "gpu");
            const cpuModels = MODELS.filter((m) => m.engine === "cpu");
            // Phones and tablets always see every choice they can run.
            const list = gpuOk ? (state.showAll || isMobile() || modelFor(state.model).engine === "cpu" ? [...gpuModels, ...cpuModels] : gpuModels) : cpuModels;
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
          const engineKind = modelFor(state.model).engine;
          if (engineKind === "cpu" && (await setIsolation(true)) && !self.crossOriginIsolated) {
            // Pick up where we left off after a quick reload that unlocks all the processor's cores.
            save({ model: state.model, resume: true });
            if (await reloadForIsolation()) return;
            save({ resume: false });
          } else if (engineKind === "gpu") setIsolation(false);
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
          if (autoStart) start();
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
    if (GA.AI.mode() === "proxy") return;
    if (cfg().resume) {
      // Came back from the multi-core reload in the middle of setup: carry on.
      save({ resume: false });
      openSetup({ autoStart: true, onDone: () => GA.App && GA.App.refreshAll() });
      return;
    }
    if (!cfg().ready || backend || loading) return;
    pick().then((m) => m.engine === "cpu" && setIsolation(true)); // multi-core from the next visit
    // Only warm up from what's already on the device. If the download is gone
    // (e.g. the browser cleared storage), it happens when they next chat, with
    // progress shown, instead of silently using gigabytes in the background.
    pick().then((m) => isDownloaded(m.key)).then((have) => have && load().catch(() => {}));
  }

  GA.Brain = {
    MODELS,
    TIMEOUTS,
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
    threads: cpuThreads,
    grammars: { chat: chatGrammar, schema: schemaGrammar, PHONE_RECIPE_SCHEMA }, // for testing
    activity: () => activity,
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
