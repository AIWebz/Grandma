/*
 * Grandma AI — Grandma's brain, running entirely inside the web page.
 *
 * Uses WebLLM (vendor/web-llm, Apache-2.0) to run an open AI model on the
 * device's graphics chip through WebGPU. Nothing to install and no API key:
 * the browser downloads the model once from Hugging Face, keeps it in its
 * cache, and from then on Grandma works offline and privately — conversations
 * never leave the device.
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

  const MODELS = [
    { key: "3b", base: "Qwen2.5-3B-Instruct", label: "Recommended", size: "about 2 GB", note: "The best balance for most laptops and desktops." },
    { key: "1.5b", base: "Qwen2.5-1.5B-Instruct", label: "Lighter", size: "about 1 GB", note: "For phones, tablets, and older computers." },
    { key: "7b", base: "Qwen2.5-7B-Instruct", label: "Smartest", size: "about 4.5 GB", note: "Needs a computer with a strong graphics card." },
  ];
  const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const MAX_OUTPUT = 1100;
  const HISTORY_CHARS = 4200;

  const cfg = () => ({ model: "3b", ready: false, ...(Store.doc("local").brain || {}) });
  const save = (patch) => Store.setDoc("local", { brain: { ...cfg(), ...patch } });

  let libP = null;
  let gpu = null;
  let engine = null;
  let engineId = "";
  let worker = null;
  let loading = null;
  const status = { state: "idle", progress: 0, text: "" }; // idle | loading | ready | error
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(status); } catch (e) { /* ignore */ } });

  const lib = () => (libP = libP || import(new URL("vendor/web-llm/index.js", document.baseURI).href));

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

  async function modelId(key) {
    const m = MODELS.find((x) => x.key === (key || cfg().model)) || MODELS[0];
    const g = await support();
    return `${m.base}-${g.f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
  }

  async function isDownloaded(key) {
    try {
      return await (await lib()).hasModelInCache(await modelId(key));
    } catch (e) {
      return false;
    }
  }

  /* Start (or reuse) the engine. Loads from the browser cache after the first download. */
  async function load(onProgress) {
    const id = await modelId();
    if (engine && engineId === id) return engine;
    if (loading) return loading;
    loading = (async () => {
      const g = await support();
      if (!g.ok) throw new GA.AI.AIError("brain-unsupported", "WebGPU isn't available in this browser.");
      if (engine) await unload();
      status.state = "loading";
      status.progress = 0;
      status.text = "Waking Grandma up…";
      emit();
      try {
        const webllm = await lib();
        worker = new Worker(new URL("js/brain-worker.js", document.baseURI), { type: "module" });
        engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
          initProgressCallback: (r) => {
            status.progress = r.progress || 0;
            status.text = r.text || "";
            emit();
            onProgress && onProgress(r);
          },
        });
        engineId = id;
        status.state = "ready";
        status.progress = 1;
        emit();
        return engine;
      } catch (e) {
        status.state = "error";
        status.text = String((e && e.message) || e);
        emit();
        if (worker) worker.terminate();
        worker = null;
        engine = null;
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
    try { if (engine) await engine.unload(); } catch (e) { /* ignore */ }
    if (worker) worker.terminate();
    engine = null;
    worker = null;
    engineId = "";
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
- Suggesting a specific dish → create_recipe with real quantities, steps, and one or two tips.
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
  const toolDocs = (tools) => tools.map((t) => `- ${t.name} ${sig(t.input_schema)} — ${t.description.split(". ")[0]}.`).join("\n");

  const responseSchema = (tools) =>
    JSON.stringify({
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
    const context = ((system[1] && system[1].text) || "").slice(0, 2400);
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
    while (start > 0 && used + out[start - 1].content.length < HISTORY_CHARS) used += out[--start].content.length;
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
    const onAbort = () => { try { eng.interruptGenerate(); } catch (e) { /* ignore */ } };
    if (signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let raw;
    try {
      const res = await eng.chat.completions.create({
        messages: msgs,
        temperature: 0.5,
        max_tokens: MAX_OUTPUT,
        response_format: { type: "json_object", schema: responseSchema(tools.length ? tools : [{ name: "none" }]) },
      });
      raw = res.choices[0].message.content || "";
      var finish = res.choices[0].finish_reason;
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
    const res = await eng.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${instruction}\n\nText read from the photo (it may contain reading mistakes; fix obvious ones only):\n${text.slice(0, 5000)}` },
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: "json_object", schema: JSON.stringify(schema) },
    });
    const out = parseJSON(res.choices[0].message.content);
    if (!out) throw new GA.AI.AIError("brain", "Couldn't organize the recipe.");
    return out;
  }

  /* ================= "Turn on Grandma" setup ================= */
  function openSetup({ onDone } = {}) {
    const state = { step: "choose", model: cfg().model, downloaded: {}, support: null, progress: null, error: "" };

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
          } else if (!state.support.ok) {
            html += `<div class="setup-card"><p><b>This browser can't run Grandma's brain yet.</b></p>
              <p class="muted">She needs <b>WebGPU</b>, which is built into recent <b>Chrome</b> and <b>Edge</b> (computers and Android) and <b>Safari</b> on iOS 26 / macOS 26 or newer. Try one of those, or update this browser.</p>
              <p class="muted small">Everything else — recipes, tasks, groceries, the planner, and the Family Cookbook — works right now.</p>
              <div class="row wrap"><button class="btn" data-close>OK</button></div></div>`;
          } else if (state.step === "done") {
            html += `<div class="setup-card center">${U.avatar(72)}<h3>Grandma is ready ❤️</h3><p class="muted">She's running right inside this browser. Ask her what's for dinner.</p>
              <button class="btn primary" data-finish>Start chatting</button></div>`;
          } else {
            const opt = (m) => `<label class="choice ${state.model === m.key ? "on" : ""}"><input type="radio" name="model" value="${m.key}" ${state.model === m.key ? "checked" : ""} ${state.progress ? "disabled" : ""}>
                <span class="grow"><b>${m.label}</b> <span class="muted">· ${m.size}</span><small>${m.note}</small></span>${state.downloaded[m.key] ? `<span class="tag ok">Downloaded</span>` : ""}</label>`;
            const ready = state.downloaded[state.model];
            html += `<div class="setup-card"><p><b>Choose Grandma's brain.</b> ${ready ? "It's already on this device." : "It's a one-time download — Wi-Fi is best."}</p>
              <div class="choices">${MODELS.map(opt).join("")}</div>
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
              state.progress = { pct: r.progress || 0, text: friendlyProgress(r.text) };
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
            state.error = /memory|OOM|device lost|allocate/i.test(e.message)
              ? "This device ran out of graphics memory. Try the Lighter option."
              : `That didn't finish: ${e.message}. Check your internet connection and try again — it picks up where it left off.`;
          }
          view();
          GA.App && GA.App.refreshAll();
        }

        root.addEventListener("click", (e) => {
          if (e.target.closest("[data-download]")) return start();
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
          if (s.ok) for (const m of MODELS) state.downloaded[m.key] = await isDownloaded(m.key);
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
    if (!cfg().ready || engine || loading) return;
    support().then((s) => s.ok && load().catch(() => {}));
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
    ocr,
    openSetup,
    status: () => status,
    onStatus: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    async forget() {
      await unload();
      try {
        const webllm = await lib();
        for (const m of MODELS) {
          const id = await modelId(m.key);
          await webllm.deleteModelAllInfoInCache(id).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      save({ ready: false });
    },
  };
})();
