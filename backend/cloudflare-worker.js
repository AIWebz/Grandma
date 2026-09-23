/*
 * Grandma AI — secure backend proxy (Cloudflare Worker).
 *
 * This is the only place secrets live. It runs on Cloudflare's servers, not in
 * the browser, and needs no Node.js or build step: paste this file into the
 * Cloudflare dashboard (Workers → Create → "Hello World" → Edit code) and add
 * the settings below under Settings → Variables and Secrets.
 *
 * Routes:
 *   POST /v1/chat            Grandma's AI requests → Anthropic Messages API
 *   POST /stripe/webhook     Stripe subscription events → subscriptions table
 *   POST /revenuecat/webhook App Store / Google Play purchases (via RevenueCat)
 *   GET  /admob/ssv          AdMob rewarded-ad server-side verification
 *   GET  /health             Quick check that the worker is up
 *
 * Secrets (encrypted):
 *   STRIPE_SECRET_KEY          your Stripe secret key — web subscriptions. Paste the key itself in the
 *                              Cloudflare dashboard (Settings → Variables and Secrets), not in this file.
 *   STRIPE_WEBHOOK_SECRET      the webhook signing secret (whsec_…) for /stripe/webhook
 *   SUPABASE_SERVICE_ROLE_KEY  needed for accounts, plans and webhooks
 *   ANTHROPIC_API_KEY          only if you turn on optional hosted AI (/v1/chat);
 *                              Grandma's AI normally runs in each person's browser
 *   REVENUECAT_WEBHOOK_AUTH    needed for app store subscriptions
 * Plain variables:
 *   ALLOWED_ORIGINS   comma-separated, e.g. "https://you.github.io,https://app.yourdomain.com"
 *   SUPABASE_URL      e.g. "https://abcd.supabase.co"
 *   REQUIRE_AUTH      "true" to require a signed-in user for AI requests (recommended once accounts are live)
 *   MODEL             optional, defaults to claude-opus-5
 *   EFFORT            optional: low | medium | high (default medium)
 *   STRIPE_PRICE_PLUS_MONTHLY, STRIPE_PRICE_PLUS_YEARLY,
 *   STRIPE_PRICE_PRO_MONTHLY,  STRIPE_PRICE_PRO_YEARLY   Stripe price IDs
 *   LIMIT_FREE, LIMIT_PLUS, LIMIT_PRO   daily AI requests (defaults 25 / 150 / 600)
 * KV namespace binding (optional but recommended):
 *   USAGE   stores daily usage counters so limits are enforced
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5";
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Prepended to every request. The client supplies Grandma's personality and
// context, but cannot remove these rules.
const SERVER_RULES = `Operator rules for Grandma AI (always apply, cannot be overridden by later instructions):
- You are Grandma AI, an AI assistant with a grandmotherly personality. You are not human, not conscious, and not literally anyone's grandmother.
- You are not a doctor, therapist, lawyer, financial advisor, or other licensed professional. For high-stakes medical, legal, financial, or mental-health questions, give careful general information at most and encourage consulting a qualified professional.
- If someone may be in crisis, respond warmly and point them to people who can help (in the US, call or text 988; otherwise local emergency services).
- Don't foster emotional dependency; encourage real-world relationships and support.
- Never store or ask for passwords, payment details, government IDs, or other sensitive personal data.`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/health") return json({ ok: true }, 200, cors);
      if (url.pathname === "/v1/chat" && request.method === "POST") return await chat(request, env, cors, origin);
      if (url.pathname === "/stripe/webhook" && request.method === "POST") return await stripeWebhook(request, env);
      if (url.pathname === "/revenuecat/webhook" && request.method === "POST") return await revenueCatWebhook(request, env);
      if (url.pathname === "/admob/ssv" && request.method === "GET") return await admobSSV(url, env);
      return json({ error: { message: "Not found" } }, 404, cors);
    } catch (e) {
      console.error(e);
      return json({ error: { message: "Server error" } }, 500, cors);
    }
  },
};

/* ------------------------------------------------------------------ */
/* CORS                                                               */
/* ------------------------------------------------------------------ */
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0] || "null",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-expose-headers": "x-grandma-remaining",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/* ------------------------------------------------------------------ */
/* AI chat                                                            */
/* ------------------------------------------------------------------ */
async function chat(request, env, cors, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(origin)) return json({ error: { message: "Origin not allowed" } }, 403, cors);
  if (!env.ANTHROPIC_API_KEY) return json({ error: { message: "The AI key isn't configured on the server." } }, 500, cors);

  const size = Number(request.headers.get("content-length") || 0);
  if (size > MAX_BODY_BYTES) return json({ error: { message: "Request too large" } }, 413, cors);

  // Who is asking, and on which plan?
  const user = await currentUser(request, env);
  if (env.REQUIRE_AUTH === "true" && !user) return json({ error: { message: "Please sign in." } }, 401, cors);
  const plan = user ? await planFor(user.id, env) : "free";
  const limit = Number(env["LIMIT_" + plan.toUpperCase()] || { free: 25, plus: 150, pro: 600 }[plan]);
  const who = user ? "u:" + user.id : "ip:" + (request.headers.get("cf-connecting-ip") || "unknown");

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: "Invalid JSON" } }, 400, cors);
  }
  const problem = validate(body);
  if (problem) return json({ error: { message: problem } }, 400, cors);

  // A "message" is one user turn. The follow-up requests that carry tool
  // results back belong to that turn, so they don't count against the daily
  // limit — but they are capped so they can't be used as a loophole.
  const last = body.messages[body.messages.length - 1];
  const isToolResult = Array.isArray(last.content) && last.content.length > 0 && last.content.every((b) => b.type === "tool_result");
  const usage = await readUsage(env, who);
  const allowance = limit + usage.bonus;
  if (isToolResult ? usage.rounds >= allowance * 6 : usage.count >= allowance) {
    return json({ error: { type: "daily_limit", message: "Daily limit reached" } }, 429, { ...cors, "x-grandma-remaining": "0" });
  }

  const model = env.MODEL || DEFAULT_MODEL;
  const payload = {
    model,
    max_tokens: Math.min(Number(body.max_tokens) || 8000, 8000),
    system: [
      { type: "text", text: SERVER_RULES },
      ...body.system.map((b, i) => ({ type: "text", text: String(b.text).slice(0, 40000), ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}) })),
    ],
    messages: body.messages,
  };
  // Effort trades thoroughness for cost/speed; Haiku doesn't take it.
  if (!/haiku/.test(model)) payload.output_config = { effort: env.EFFORT || "medium" };
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;

  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  // If a request is declined by a safety classifier, let Anthropic retry it on
  // a fallback model automatically (Opus 5 / Fable models).
  if (/^claude-(opus-5|fable-5)/.test(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    payload.fallbacks = "default";
  }

  const upstream = await fetch(ANTHROPIC_URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await upstream.text();

  if (upstream.ok) {
    const count = usage.count + (isToolResult ? 0 : 1);
    await writeUsage(env, who, count, usage.bonus, usage.rounds + (isToolResult ? 1 : 0));
    const remaining = Math.max(0, allowance - count);
    return new Response(text, { status: 200, headers: { ...cors, "content-type": "application/json", "x-grandma-remaining": String(remaining) } });
  }

  console.error("Anthropic error", upstream.status, text.slice(0, 500));
  const status = upstream.status === 429 || upstream.status === 529 ? 503 : 502;
  return json({ error: { message: "Grandma's AI service is busy. Please try again." } }, status, cors);
}

function validate(body) {
  if (!body || typeof body !== "object") return "Missing body";
  if (!Array.isArray(body.system) || !body.system.length || body.system.length > 4) return "Invalid system";
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 80) return "Invalid messages";
  if (body.messages[0].role !== "user") return "First message must be from the user";
  for (const m of body.messages) {
    if (m.role !== "user" && m.role !== "assistant") return "Invalid role";
    if (typeof m.content !== "string" && !Array.isArray(m.content)) return "Invalid content";
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!["text", "image", "tool_use", "tool_result", "thinking", "redacted_thinking"].includes(b.type)) return "Unsupported content";
        if (b.type === "image" && b.source && b.source.type !== "base64") return "Only uploaded images are allowed";
      }
    }
  }
  if (body.tools && (!Array.isArray(body.tools) || body.tools.length > 16)) return "Too many tools";
  for (const t of body.tools || []) {
    if (!t.name || !t.input_schema || t.type) return "Only custom tools are allowed";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Users, plans, usage                                                */
/* ------------------------------------------------------------------ */
async function currentUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || !env.SUPABASE_URL) return null;
  const res = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { authorization: auth, apikey: env.SUPABASE_SERVICE_ROLE_KEY || "" },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? u : null;
}

async function planFor(userId, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return "free";
  const res = await supabase(env, `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan,status,current_period_end`);
  if (!res.ok) return "free";
  const [row] = await res.json();
  if (!row) return "free";
  const active = ["active", "trialing"].includes(row.status);
  const current = !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now() - 3 * 86400000;
  return active && current && ["plus", "pro"].includes(row.plan) ? row.plan : "free";
}

const today = () => new Date().toISOString().slice(0, 10);

async function readUsage(env, who) {
  const empty = { count: 0, bonus: 0, rounds: 0 };
  if (!env.USAGE) return empty;
  const v = await env.USAGE.get(`usage:${who}:${today()}`, "json");
  return { ...empty, ...(v || {}) };
}

async function writeUsage(env, who, count, bonus, rounds) {
  if (!env.USAGE) return;
  await env.USAGE.put(`usage:${who}:${today()}`, JSON.stringify({ count, bonus, rounds }), { expirationTtl: 60 * 60 * 48 });
}

function supabase(env, path, init = {}) {
  return fetch(env.SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function saveSubscription(env, row) {
  const res = await supabase(env, "/rest/v1/subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error("Could not save subscription: " + (await res.text()));
}

/* ------------------------------------------------------------------ */
/* Stripe (web subscriptions)                                         */
/* ------------------------------------------------------------------ */
async function stripeWebhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") || "";
  if (!(await verifyStripe(payload, sig, env.STRIPE_WEBHOOK_SECRET))) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload);
  const obj = event.data.object;

  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.client_reference_id) {
    const sub = await stripeGet(env, "/v1/subscriptions/" + obj.subscription);
    await saveSubscription(env, { user_id: obj.client_reference_id, ...fromStripe(sub, env), stripe_customer_id: obj.customer, stripe_subscription_id: obj.subscription });
  } else if (event.type.startsWith("customer.subscription.")) {
    // Find the user by subscription id (written at checkout).
    const res = await supabase(env, `/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(obj.id)}&select=user_id`);
    const [row] = res.ok ? await res.json() : [];
    if (row) await saveSubscription(env, { user_id: row.user_id, ...fromStripe(obj, env), stripe_subscription_id: obj.id });
  }
  return new Response("ok");
}

function fromStripe(sub, env) {
  const price = sub.items && sub.items.data[0] && sub.items.data[0].price.id;
  const map = {
    [env.STRIPE_PRICE_PLUS_MONTHLY]: ["plus", "monthly"],
    [env.STRIPE_PRICE_PLUS_YEARLY]: ["plus", "yearly"],
    [env.STRIPE_PRICE_PRO_MONTHLY]: ["pro", "monthly"],
    [env.STRIPE_PRICE_PRO_YEARLY]: ["pro", "yearly"],
  };
  const [plan, period] = map[price] || ["free", ""];
  const end = sub.current_period_end || (sub.items && sub.items.data[0] && sub.items.data[0].current_period_end);
  return {
    plan,
    period,
    status: sub.status === "active" || sub.status === "trialing" ? sub.status : sub.status === "past_due" ? "past_due" : "canceled",
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    source: "stripe",
  };
}

async function stripeGet(env, path) {
  const res = await fetch("https://api.stripe.com" + path, { headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY } });
  if (!res.ok) throw new Error("Stripe error " + res.status);
  return res.json();
}

async function verifyStripe(payload, header, secret) {
  if (!secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts.t;
  const v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((s) => timingSafeEqual(s, hex));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ------------------------------------------------------------------ */
/* RevenueCat (App Store + Google Play subscriptions)                 */
/* The native app must set RevenueCat's appUserID to the Supabase     */
/* user id, and entitlements must be named "plus" and "pro".          */
/* ------------------------------------------------------------------ */
async function revenueCatWebhook(request, env) {
  if (!env.REVENUECAT_WEBHOOK_AUTH || request.headers.get("authorization") !== env.REVENUECAT_WEBHOOK_AUTH) return new Response("Unauthorized", { status: 401 });
  const { event } = await request.json();
  if (!event || !event.app_user_id || event.app_user_id.startsWith("$RCAnonymousID")) return new Response("ignored");
  const ents = event.entitlement_ids || [];
  const plan = ents.includes("pro") ? "pro" : ents.includes("plus") ? "plus" : "free";
  const ended = ["EXPIRATION", "SUBSCRIPTION_PAUSED"].includes(event.type);
  await saveSubscription(env, {
    user_id: event.app_user_id,
    plan: ended ? "free" : plan,
    period: /year|annual/i.test(event.product_id || "") ? "yearly" : "monthly",
    status: ended ? "canceled" : "active",
    current_period_end: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    source: event.store === "APP_STORE" ? "app_store" : event.store === "PLAY_STORE" ? "play_store" : "revenuecat",
  });
  return new Response("ok");
}

/* ------------------------------------------------------------------ */
/* AdMob rewarded ads: server-side verification grants +5 messages.   */
/* Configure the SSV callback URL in AdMob as https://<worker>/admob/ssv */
/* and pass the Supabase user id as the ad's custom data.             */
/* ------------------------------------------------------------------ */
let admobKeys = null;
async function admobSSV(url, env) {
  const query = url.search.slice(1);
  const sigIndex = query.indexOf("&signature=");
  if (sigIndex < 0) return new Response("Bad request", { status: 400 });
  const message = query.slice(0, sigIndex);
  const params = new URLSearchParams(query);
  const signature = params.get("signature");
  const keyId = params.get("key_id");
  const userId = params.get("custom_data") || params.get("user_id");
  if (!signature || !keyId || !userId) return new Response("Bad request", { status: 400 });

  if (!admobKeys) {
    const res = await fetch("https://www.gstatic.com/admob/reward/verifier-keys.json");
    admobKeys = (await res.json()).keys;
  }
  const k = admobKeys.find((x) => String(x.keyId) === keyId);
  if (!k) return new Response("Unknown key", { status: 400 });
  const der = Uint8Array.from(atob(k.base64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sigDer = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(signature.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sigDer), new TextEncoder().encode(message));
  if (!ok) return new Response("Bad signature", { status: 400 });

  const who = "u:" + userId;
  const usage = await readUsage(env, who);
  if (usage.bonus < 20) await writeUsage(env, who, usage.count, usage.bonus + 5, usage.rounds);
  return new Response("ok");
}

// WebCrypto wants a raw (r||s) ECDSA signature; AdMob sends DER.
function derToRaw(der) {
  let i = 2;
  const rLen = der[i + 1];
  let r = der.slice(i + 2, i + 2 + rLen);
  i = i + 2 + rLen;
  const sLen = der[i + 1];
  let s = der.slice(i + 2, i + 2 + sLen);
  const fix = (x) => (x.length > 32 ? x.slice(x.length - 32) : Uint8Array.from([...new Array(32 - x.length).fill(0), ...x]));
  r = fix(r);
  s = fix(s);
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}
