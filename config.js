/*
 * Grandma AI — public configuration.
 *
 * EVERYTHING IN THIS FILE IS PUBLIC. It ships to every browser that opens the
 * app, so never put a secret here (no Anthropic key, no Stripe secret key, no
 * Supabase service-role key). Secrets live in the backend proxy
 * (backend/cloudflare-worker.js) as encrypted environment variables.
 *
 * Every section is optional. With nothing filled in, the app still runs:
 * data stays on this device, and Grandma's AI runs inside each person's browser.
 * See README.md for step-by-step setup of each section.
 */
window.GRANDMA_CONFIG = {
  ai: {
    // Grandma's AI runs entirely inside each person's browser (WebLLM on
    // WebGPU) — no install, no API key, nothing to set here.
    //
    // Optional: to serve AI from a server instead (e.g. for browsers without
    // WebGPU), deploy backend/cloudflare-worker.js and put its URL here.
    // Leave "" to use the in-browser AI.
    endpoint: "",
  },

  // Supabase powers accounts (email + Google) and cloud sync.
  // The anon key is designed to be public; Row Level Security protects data.
  supabase: {
    url: "",
    anonKey: "",
    googleSignIn: true,
  },

  billing: {
    // "stripe" for the web, "native" when a native wrapper exposes
    // window.GrandmaNative (App Store / Google Play in-app purchases),
    // or "none" to hide purchase buttons.
    provider: "stripe",
    // Owner testing only: plan buttons switch plans instantly with no payment,
    // so you can try every paid feature. MUST be false in production.
    demoMode: false,
    stripe: {
      // Stripe Payment Links (Dashboard → Payment Links). The app appends
      // ?client_reference_id=<user id> so the webhook knows who paid.
      paymentLinks: {
        plus_monthly: "",
        plus_yearly: "",
        pro_monthly: "",
        pro_yearly: "",
      },
      // Stripe customer portal link for "Manage subscription".
      customerPortalUrl: "",
    },
    // Product IDs your native wrapper sells through StoreKit / Play Billing.
    nativeProducts: {
      plus_monthly: "grandma_plus_monthly",
      plus_yearly: "grandma_plus_yearly",
      pro_monthly: "grandma_pro_monthly",
      pro_yearly: "grandma_pro_yearly",
    },
  },

  ads: {
    // "house"   — tasteful self-promotion for Grandma+ (no ad network needed)
    // "adsense" — Google AdSense on the web
    // "native"  — AdMob through the native wrapper (window.GrandmaNative)
    // "none"    — no ads at all
    provider: "house",
    adsense: { client: "", bannerSlot: "" },
    // Interstitials only ever appear on page transitions, never mid-chat,
    // and at most once per this many minutes.
    interstitialMinutes: 10,
    rewardedEnabled: true,
  },

  legal: {
    termsUrl: "terms.html",
    privacyUrl: "privacy.html",
    supportEmail: "",
  },
};
