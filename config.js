/*
 * Grandma AI — public configuration.
 *
 * EVERYTHING IN THIS FILE IS PUBLIC. It ships to every browser that opens the
 * app, so never put a secret here (no Anthropic key, no Stripe secret key, no
 * Supabase service-role key). Secrets live in the backend proxy
 * (backend/cloudflare-worker.js) as encrypted environment variables.
 *
 * Every section is optional. With nothing filled in, the app still runs:
 * data stays on this device, and Grandma asks you to connect an AI service.
 * See README.md for step-by-step setup of each section.
 */
window.GRANDMA_CONFIG = {
  ai: {
    // URL of your deployed AI proxy, e.g. "https://grandma-ai.<you>.workers.dev".
    // The proxy holds the Anthropic API key; the browser never sees it.
    endpoint: "",

    // Lets a developer paste their own Anthropic API key under
    // Settings → AI connection, stored only in that browser. Handy for local
    // testing before the proxy exists. Set to false for production builds.
    allowDeveloperKey: true,
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
