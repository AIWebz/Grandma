/*
 * Grandma AI — local AI with Ollama (https://ollama.com).
 *
 * Grandma's "brain" runs on the person's own computer: free, private, and
 * with no account or API key. This file talks to Ollama's local API
 * (http://localhost:11434) and provides the in-app setup wizard that walks
 * people through installing Ollama, letting this website connect to it, and
 * downloading a model — with a live progress bar.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;

  const DEFAULT_URL = "http://localhost:11434";
  const MODELS = [
    { id: "llama3.1:8b", label: "Recommended", size: "4.9 GB", note: "Best for most computers (8 GB of memory or more)." },
    { id: "llama3.2:3b", label: "Lighter", size: "2.0 GB", note: "For older or smaller computers. A little less clever." },
  ];
  const VISION = { id: "qwen2.5vl:7b", size: "6 GB" };
  const DOWNLOADS = {
    windows: { label: "Download for Windows", href: "https://ollama.com/download/OllamaSetup.exe" },
    mac: { label: "Download for Mac", href: "https://ollama.com/download/Ollama.dmg" },
    linux: { label: "Install on Linux", command: "curl -fsSL https://ollama.com/install.sh | sh" },
  };

  const cfg = () => ({ url: DEFAULT_URL, model: MODELS[0].id, visionModel: "", ready: false, ...(Store.doc("local").ollama || {}) });
  const base = () => cfg().url.replace(/\/$/, "");
  const save = (patch) => Store.setDoc("local", { ollama: { ...cfg(), ...patch } });

  function os() {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "mobile";
    if (/Windows/i.test(ua)) return "windows";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  /* Commands that let this website talk to Ollama (only needed off localhost). */
  function originCommand(system) {
    const o = location.origin;
    if (system === "windows") return `setx OLLAMA_ORIGINS "${o}"`;
    if (system === "mac") return `launchctl setenv OLLAMA_ORIGINS "${o}"`;
    return `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${o}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/grandma.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama`;
  }
  const originSteps = {
    windows: "Open <b>Command Prompt</b> (search for “cmd”), paste this, and press Enter. Then right-click the Ollama icon near the clock, choose <b>Quit Ollama</b>, and open Ollama again.",
    mac: "Open <b>Terminal</b> (search for it with ⌘ Space), paste this, and press Return. Then click the Ollama icon in the menu bar, choose <b>Quit Ollama</b>, and open Ollama again.",
    linux: "Paste this into a terminal and press Enter. Ollama restarts by itself.",
  };

  /* ---------------- API ---------------- */
  async function status() {
    try {
      const r = await fetch(base() + "/api/version", { cache: "no-store" });
      if (r.ok) return { state: "ok", version: (await r.json()).version };
    } catch (e) { /* blocked or not running */ }
    // An opaque request still succeeds when Ollama is running but hasn't
    // allowed this website yet — that tells the two problems apart.
    try {
      await fetch(base() + "/api/version", { mode: "no-cors", cache: "no-store" });
      return { state: "blocked" };
    } catch (e) {
      return { state: "offline" };
    }
  }

  async function installed() {
    try {
      const r = await fetch(base() + "/api/tags", { cache: "no-store" });
      if (!r.ok) return [];
      return ((await r.json()).models || []).map((m) => m.name);
    } catch (e) {
      return [];
    }
  }
  const has = (list, id) => list.includes(id) || list.includes(id + ":latest") || (!id.includes(":") && list.some((n) => n.startsWith(id + ":")));

  /* Download a model, reporting progress as 0..1. */
  async function pull(model, onProgress, signal) {
    const r = await fetch(base() + "/api/pull", { method: "POST", body: JSON.stringify({ model, stream: true }), signal });
    if (!r.ok || !r.body) throw new Error("Couldn't start the download.");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const parts = {};
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.error) throw new Error(ev.error);
        if (ev.digest && ev.total) parts[ev.digest] = { total: ev.total, completed: ev.completed || 0 };
        const total = Object.values(parts).reduce((a, p) => a + p.total, 0);
        const got = Object.values(parts).reduce((a, p) => a + p.completed, 0);
        onProgress && onProgress(total ? got / total : 0, ev.status, got, total);
        if (ev.status === "success") return;
      }
    }
  }

  /* ---------- Grandma's message format <-> Ollama's ---------- */
  function toOllama(system, messages) {
    const out = [{ role: "system", content: system.map((b) => b.text).join("\n\n") }];
    const names = {};
    for (const m of messages) {
      if (typeof m.content === "string") {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      if (m.role === "assistant") {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const calls = m.content.filter((b) => b.type === "tool_use").map((b) => {
          names[b.id] = b.name;
          return { function: { name: b.name, arguments: b.input || {} } };
        });
        out.push({ role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) });
        continue;
      }
      for (const r of m.content.filter((b) => b.type === "tool_result")) {
        out.push({ role: "tool", content: typeof r.content === "string" ? r.content : JSON.stringify(r.content), tool_name: names[r.tool_use_id] });
      }
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const images = m.content.filter((b) => b.type === "image").map((b) => b.source.data);
      if (text || images.length) out.push({ role: "user", content: text || "What do you see?", ...(images.length ? { images } : {}) });
    }
    return out;
  }

  const safeJSON = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  };

  /* Small local models sometimes write a tool call as plain JSON text. */
  function textToolCall(text, tools) {
    const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    if (!t.startsWith("{")) return null;
    const j = safeJSON(t);
    if (!j || !j.name || !tools.some((x) => x.name === j.name)) return null;
    return { name: j.name, input: j.parameters || j.arguments || j.input || {} };
  }

  function fromOllama(data, tools) {
    const msg = data.message || {};
    let text = String(msg.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    let calls = (msg.tool_calls || []).map((c) => ({
      name: c.function.name,
      input: typeof c.function.arguments === "string" ? safeJSON(c.function.arguments) || {} : c.function.arguments || {},
    }));
    if (!calls.length && tools.length) {
      const guessed = textToolCall(text, tools);
      if (guessed) {
        calls = [guessed];
        text = "";
      }
    }
    const content = [];
    if (text) content.push({ type: "text", text });
    calls.forEach((c, i) => content.push({ type: "tool_use", id: `call_${Date.now().toString(36)}_${i}`, name: c.name, input: c.input }));
    return { content, stop_reason: calls.length ? "tool_use" : data.done_reason === "length" ? "max_tokens" : "end_turn" };
  }

  function fail(res, body) {
    const msg = (body && body.error) || res.statusText || "Ollama error";
    const AIError = GA.AI.AIError;
    if (/not found|pull/i.test(msg)) return new AIError("ollama-model", msg, res.status);
    return new AIError("server", msg, res.status);
  }

  async function post(path, payload, signal) {
    let res;
    try {
      res = await fetch(base() + path, { method: "POST", body: JSON.stringify(payload), signal });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new GA.AI.AIError("ollama-offline", "Can't reach Ollama");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw fail(res, body);
    return body;
  }

  /* One model turn. Returns the same shape the rest of the app expects. */
  async function chat({ system, messages, tools, maxTokens, signal }) {
    const c = cfg();
    const withImages = messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"));
    const model = withImages && c.visionModel ? c.visionModel : c.model;
    let msgs = toOllama(system, messages);
    if (withImages && !c.visionModel) {
      // The chat model can't see photos; say so instead of failing.
      msgs = msgs.map((m) => (m.images ? { role: m.role, content: (m.content || "") + "\n[They attached a photo, but photo reading isn't set up. Kindly suggest turning it on in Settings → AI.]" } : m));
    }
    const payload = {
      model,
      messages: msgs,
      stream: false,
      options: { num_ctx: 8192, temperature: 0.6, num_predict: Math.min(maxTokens || 4096, 4096) },
    };
    const ollamaTools = (tools || []).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (ollamaTools.length) payload.tools = ollamaTools;
    try {
      return fromOllama(await post("/api/chat", payload, signal), tools || []);
    } catch (e) {
      // Some models (often vision ones) can't use tools: answer without them.
      if (payload.tools && /does not support tools/i.test(e.message)) {
        delete payload.tools;
        return fromOllama(await post("/api/chat", payload, signal), []);
      }
      throw e;
    }
  }

  /* Structured JSON output (used to read handwritten recipe cards). */
  async function json({ instruction, images, schema, system }) {
    const c = cfg();
    if (!c.visionModel) throw new GA.AI.AIError("ollama-vision", "Photo reading isn't set up.");
    const body = await post("/api/chat", {
      model: c.visionModel,
      stream: false,
      format: schema,
      options: { num_ctx: 8192, temperature: 0.1 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: instruction + "\n\nAnswer only with JSON that matches the schema.", images },
      ],
    });
    const out = safeJSON(String((body.message || {}).content || "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (!out) throw new GA.AI.AIError("server", "Couldn't read the recipe.");
    return out;
  }

  /* ================= Setup wizard ================= */
  function openSetup({ onDone } = {}) {
    const system = os();
    const state = { step: 1, status: null, installed: [], model: cfg().model || MODELS[0].id, vision: Boolean(cfg().visionModel), progress: null, error: "" };
    let poll = null;
    let abort = null;

    U.openSheet({
      title: "Set up Grandma's AI",
      wide: true,
      body: `<div class="setup" data-setup></div>`,
      onMount(sheet, close) {
        const root = sheet.querySelector("[data-setup]");

        const stepsBar = () => `
          <ol class="setup-steps">${["Install Ollama", "Connect", "Download Grandma", "Done"].map((l, i) => `<li class="${state.step > i + 1 ? "done" : state.step === i + 1 ? "on" : ""}"><span>${state.step > i + 1 ? U.icon("check") : i + 1}</span>${l}</li>`).join("")}</ol>`;

        const copyBox = (cmd) => `<div class="cmd"><code>${U.esc(cmd)}</code><button class="btn small" data-copy-cmd="${U.esc(cmd)}">${U.icon("copy")}Copy</button></div>`;

        function view() {
          let html = `<div class="setup-hero">${U.avatar(56)}<div><h3>Grandma runs right on your computer</h3><p class="muted">She uses <b>Ollama</b>, a free app for private AI. No account, no API key, and your conversations stay on your computer.</p></div></div>${stepsBar()}`;

          if (state.step === 1) {
            if (system === "mobile") {
              html += `<div class="setup-card"><p><b>Ollama runs on a computer</b> (Windows, Mac, or Linux), not on phones or tablets.</p>
                <p class="muted">Open Grandma AI on your computer to finish setup there. Everything else in the app — recipes, tasks, grocery lists, and the planner — works on this device right now.</p>
                <div class="row wrap"><button class="btn" data-close>Maybe later</button><button class="btn ghost" data-next>I'm on a computer — continue</button></div></div>`;
            } else {
              const d = DOWNLOADS[system];
              html += `<div class="setup-card"><p><b>1. Download and install Ollama.</b> It takes about a minute.</p>
                ${d.command ? copyBox(d.command) : `<a class="btn primary big" href="${d.href}" target="_blank" rel="noopener">${U.icon("download")}${d.label}</a>`}
                <p class="muted small">Different computer? <a href="https://ollama.com/download" target="_blank" rel="noopener">See all downloads</a></p>
                <p class="muted small">After it's installed, open Ollama once. Grandma will find it automatically.</p>
                <div class="row wrap"><button class="btn primary" data-next>I've installed it</button></div></div>`;
            }
          } else if (state.step === 2) {
            const s = state.status ? state.status.state : "checking";
            if (s === "blocked") {
              html += `<div class="setup-card"><p><b>Almost there — Ollama needs your permission to talk to this website.</b></p>
                <p class="muted">${originSteps[system === "mobile" ? "linux" : system]}</p>
                ${copyBox(originCommand(system))}
                <p class="muted small waiting">${U.icon("refresh", "spin")} Waiting for Ollama…</p></div>`;
            } else if (s === "offline") {
              html += `<div class="setup-card"><p><b>Open the Ollama app.</b></p>
                <p class="muted">${system === "mac" ? "Find Ollama in your Applications folder. A llama icon appears in the menu bar." : system === "windows" ? "Find Ollama in the Start menu. A llama icon appears near the clock." : "Run <code>ollama serve</code> if it isn't already running."}</p>
                <p class="muted small waiting">${U.icon("refresh", "spin")} Looking for Ollama on this computer…</p>
                <p class="muted small">Using Safari? If Grandma can't find Ollama, try Chrome, Edge, or Firefox. If your browser asks to let this site connect to apps on this device, choose <b>Allow</b>.</p>
                <div class="row wrap"><button class="btn ghost" data-back>Back</button></div></div>`;
            } else {
              html += `<div class="setup-card"><p class="muted waiting">${U.icon("refresh", "spin")} Looking for Ollama on this computer…</p></div>`;
            }
          } else if (state.step === 3) {
            const opt = (m) => {
              const ok = has(state.installed, m.id);
              return `<label class="choice ${state.model === m.id ? "on" : ""}"><input type="radio" name="model" value="${m.id}" ${state.model === m.id ? "checked" : ""}>
                <span class="grow"><b>${m.label}</b> <span class="muted">${U.esc(m.id)} · ${m.size}</span><small>${m.note}</small></span>${ok ? `<span class="tag ok">Installed</span>` : ""}</label>`;
            };
            html += `<div class="setup-card"><p><b>Download Grandma's brain.</b> This is a one-time download.</p>
              <div class="choices">${MODELS.map(opt).join("")}</div>
              <label class="choice ${state.vision ? "on" : ""}"><input type="checkbox" name="vision" ${state.vision ? "checked" : ""}>
                <span class="grow"><b>Let Grandma read photos</b> <span class="muted">${VISION.id} · ${VISION.size}</span><small>For handwritten recipe cards and photos you attach. Optional.</small></span>${has(state.installed, VISION.id) ? `<span class="tag ok">Installed</span>` : ""}</label>
              ${state.progress ? `<div class="progress"><i style="width:${Math.round(state.progress.pct * 100)}%"></i></div><p class="muted small">${U.esc(state.progress.text)}</p>` : ""}
              ${state.error ? `<p class="form-error">${U.esc(state.error)}</p>` : ""}
              <div class="row wrap">${state.progress ? `<button class="btn ghost" data-cancel>Cancel</button>` : `<button class="btn primary" data-download>${U.icon("download")}Download &amp; finish</button>`}</div></div>`;
          } else {
            html += `<div class="setup-card center">${U.avatar(72)}<h3>Grandma is ready ❤️</h3><p class="muted">She's running on your computer now. Ask her what's for dinner.</p>
              <button class="btn primary" data-finish>Start chatting</button></div>`;
          }
          root.innerHTML = html;
        }

        async function check() {
          state.status = await status();
          if (!document.body.contains(sheet)) return;
          if (state.status.state === "ok" && state.step <= 2) {
            state.installed = await installed();
            state.step = 3;
            stopPoll();
          }
          view();
        }
        const startPoll = () => { stopPoll(); check(); poll = setInterval(check, 2000); };
        const stopPoll = () => { clearInterval(poll); poll = null; };

        async function download() {
          state.error = "";
          const wanted = [state.model].concat(state.vision ? [VISION.id] : []).filter((m) => !has(state.installed, m));
          abort = new AbortController();
          try {
            for (let i = 0; i < wanted.length; i++) {
              const m = wanted[i];
              state.progress = { pct: 0, text: `Starting ${m}…` };
              view();
              await pull(m, (pct, st, got, total) => {
                state.progress = { pct, text: total ? `${wanted.length > 1 ? `(${i + 1} of ${wanted.length}) ` : ""}Downloading ${m} — ${(got / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB` : st || "Preparing…" };
                const bar = root.querySelector(".progress i");
                const txt = root.querySelector(".progress + p");
                if (bar) bar.style.width = Math.round(pct * 100) + "%";
                if (txt) txt.textContent = state.progress.text;
              }, abort.signal);
            }
            save({ model: state.model, visionModel: state.vision ? VISION.id : "", ready: true });
            state.progress = null;
            state.step = 4;
          } catch (e) {
            state.progress = null;
            state.error = e.name === "AbortError" ? "Download cancelled. You can pick up where you left off anytime." : `The download stopped: ${e.message}. Check your internet connection and try again.`;
          }
          abort = null;
          view();
          GA.App && GA.App.refreshAll();
        }

        root.addEventListener("click", async (e) => {
          const c = e.target.closest("[data-copy-cmd]");
          if (c) {
            try {
              await navigator.clipboard.writeText(c.dataset.copyCmd);
              U.toast("Copied — now paste it");
            } catch (err) { U.toast("Select the text and copy it"); }
            return;
          }
          if (e.target.closest("[data-next]")) { state.step = 2; view(); startPoll(); return; }
          if (e.target.closest("[data-back]")) { stopPoll(); state.step = 1; view(); return; }
          if (e.target.closest("[data-download]")) return download();
          if (e.target.closest("[data-cancel]")) { abort && abort.abort(); return; }
          if (e.target.closest("[data-finish]")) {
            close();
            onDone && onDone();
          }
        });
        root.addEventListener("change", (e) => {
          if (e.target.name === "model") state.model = e.target.value;
          if (e.target.name === "vision") state.vision = e.target.checked;
          view();
        });

        view();
        // Already installed and running? Skip straight ahead.
        status().then(async (s) => {
          if (s.state === "ok" && state.step === 1) {
            state.status = s;
            state.installed = await installed();
            state.step = 3;
            view();
          }
        });

        const obs = new MutationObserver(() => {
          if (!document.body.contains(sheet)) {
            obs.disconnect();
            stopPoll();
            abort && abort.abort();
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      },
    });
  }

  GA.Ollama = { DEFAULT_URL, MODELS, VISION, cfg, save, os, status, installed, has, pull, chat, json, openSetup };
})();
