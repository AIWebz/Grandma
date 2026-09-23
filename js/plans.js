/*
 * Grandma AI — plans, pricing, feature limits, and purchases.
 *
 * The plan shown here is only a convenience for the UI. The real limits are
 * enforced by the AI proxy (backend/cloudflare-worker.js), which reads the
 * plan from the database row that only the payment webhooks can write.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = window.GRANDMA_CONFIG || {};

  const YEARLY_DISCOUNT = 0.2;

  const PLANS = {
    free: {
      id: "free",
      name: "Free",
      monthly: 0,
      tagline: "For users trying Grandma AI.",
      cta: "Get Started",
      limits: { dailyMessages: 25, memory: 15, savedRecipes: 10, recipeGens: 3, planDays: 2 },
      perks: {},
      voiceReplies: false,
      ads: true,
      household: false,
      features: [
        "Grandma AI conversations",
        "Basic recipes",
        "Basic tasks",
        "Basic daily planning",
        "Basic grocery lists",
        "Limited AI usage",
        "Limited personalization/memory",
        "Advertisements",
      ],
    },
    plus: {
      id: "plus",
      name: "Grandma+",
      monthly: 7.99,
      tagline: "For people who want Grandma as part of their everyday routine.",
      cta: "Start Grandma+",
      badge: "MOST POPULAR",
      limits: { dailyMessages: 150, memory: 150, savedRecipes: Infinity, recipeGens: 25, planDays: 3 },
      perks: { voiceReplies: true, cookingPrefs: true, mealPlan: true, recurring: true, autoGrocery: true, accents: true },
      voiceReplies: true,
      ads: false,
      household: false,
      features: [
        "Everything in Free",
        "No advertisements",
        "Higher AI usage limits",
        "Expanded Grandma memory",
        "Personalized recipes",
        "Advanced meal planning",
        "Advanced task planning",
        "Automatic grocery lists",
        "Voice conversations",
        "Recipe saving",
        "More personalization options",
      ],
    },
    pro: {
      id: "pro",
      name: "Grandma Pro",
      monthly: 14.99,
      tagline: "For power users and families who want the full Grandma AI experience.",
      cta: "Start Grandma Pro",
      limits: { dailyMessages: 600, memory: Infinity, savedRecipes: Infinity, recipeGens: Infinity, planDays: 31 },
      perks: { voiceReplies: true, cookingPrefs: true, mealPlan: true, recurring: true, autoGrocery: true, accents: true, weekPlan: true, routines: true, handsFree: true, voicePick: true, labs: true, bigBrain: true },
      voiceReplies: true,
      ads: false,
      household: true,
      features: [
        "Everything in Grandma+",
        "Highest AI usage limits",
        "Advanced long-term memory",
        "Unlimited personalized recipe generation",
        "Advanced weekly planning",
        "Advanced household routines",
        "Family Cookbook collaboration",
        "Multiple household members",
        "Shared tasks",
        "Shared grocery lists",
        "Advanced voice conversations",
        "Priority access to new AI features",
        "Early access to experimental features",
      ],
    },
  };

  /* Yearly price = 12 months minus 20%, rounded to the cent. */
  const yearlyPrice = (plan) => Math.round(plan.monthly * 12 * (1 - YEARLY_DISCOUNT) * 100) / 100;
  const yearlyMonthlyEquivalent = (plan) => Math.round((yearlyPrice(plan) / 12) * 100) / 100;

  const Plans = {
    PLANS,
    YEARLY_DISCOUNT,
    yearlyPrice,
    yearlyMonthlyEquivalent,

    current() {
      const sub = Store.doc("subscription");
      const active = sub.status === "active" || sub.status === "trialing";
      const notExpired = !sub.renewsAt || new Date(sub.renewsAt).getTime() > Date.now() - 3 * 86400000;
      const id = active && notExpired && PLANS[sub.plan] ? sub.plan : "free";
      return PLANS[id];
    },
    is(id) {
      return Plans.current().id === id;
    },
    atLeast(id) {
      const order = ["free", "plus", "pro"];
      return order.indexOf(Plans.current().id) >= order.indexOf(id);
    },
    limit(name) {
      return Plans.current().limits[name];
    },
    /* Is a paid feature included in the current plan? */
    can(perk) {
      return Boolean(Plans.current().perks[perk]);
    },
    /* Cheapest plan that includes a perk (for "Included with …" labels). */
    planFor(perk) {
      return PLANS.plus.perks[perk] ? PLANS.plus : PLANS.pro;
    },
    /* Returns true if allowed; otherwise explains the upgrade and returns false. */
    gate(perk, what) {
      if (Plans.can(perk)) return true;
      const p = Plans.planFor(perk);
      U.openSheet({
        title: `${what} is part of ${p.name}`,
        body: `<div class="upsell">${U.avatar(56)}
            <p>${U.esc(what)} comes with <b>${U.esc(p.name)}</b>${p.id === "plus" ? " and Grandma Pro" : ""}.</p>
            <p class="muted">${U.esc(p.tagline)}</p>
            <div class="sheet-actions"><button class="btn ghost" data-close>Not now</button><button class="btn primary" data-close data-route="pricing">See plans</button></div>
          </div>`,
      });
      return false;
    },

    /* Recipe generations per day (Free 3, Grandma+ 25, Pro unlimited). */
    recipeGensLeft() {
      const g = Store.doc("local").recipeGens || {};
      const used = g.date === U.today() ? g.count : 0;
      return Math.max(0, Plans.limit("recipeGens") - used);
    },
    recordRecipeGen() {
      const g = Store.doc("local").recipeGens || {};
      const count = (g.date === U.today() ? g.count : 0) + 1;
      Store.setDoc("local", { recipeGens: { date: U.today(), count } });
    },

    /* Local, soft usage counter so the UI can warn before the proxy refuses. */
    usage() {
      const u = Store.doc("local").usage || {};
      const today = U.today();
      return u.date === today ? u.count : 0;
    },
    bonus() {
      const b = Store.doc("local").bonus || {};
      return b.date === U.today() ? b.count || 0 : 0;
    },
    remainingMessages() {
      return Math.max(0, Plans.limit("dailyMessages") + Plans.bonus() - Plans.usage());
    },
    recordMessage() {
      // The proxy reports the authoritative count itself (see syncRemaining).
      if (GA.AI && GA.AI.mode() === "proxy") return;
      const today = U.today();
      const u = Store.doc("local").usage || {};
      const count = u.date === today ? u.count + 1 : 1;
      Store.setDoc("local", { usage: { date: today, count } });
    },
    /* The proxy tells us the authoritative remaining count. */
    syncRemaining(remaining) {
      if (remaining == null || isNaN(remaining)) return;
      const limit = Plans.limit("dailyMessages") + Plans.bonus();
      Store.setDoc("local", { usage: { date: U.today(), count: Math.max(0, limit - Number(remaining)) } });
    },

    /* ---------- purchases ---------- */
    provider() {
      if (window.GrandmaNative && typeof window.GrandmaNative.purchase === "function") return "native";
      return (CFG.billing && CFG.billing.provider) || "none";
    },

    demo: () => Boolean(CFG.billing && CFG.billing.demoMode),

    async purchase(planId, period) {
      const key = `${planId}_${period}`;
      const provider = Plans.provider();
      // Owner testing only (config.js → billing.demoMode). Never enable in production.
      if (Plans.demo()) {
        Store.setDoc("subscription", { plan: planId, status: "active", period, renewsAt: null, source: "demo" });
        U.toast(`Demo mode: you're now on ${PLANS[planId].name}. No charge.`);
        return;
      }
      if (provider === "native") {
        const productId = (CFG.billing.nativeProducts || {})[key];
        try {
          const result = await window.GrandmaNative.purchase(productId, GA.Account && GA.Account.userId());
          if (result && result.plan) Plans.applyEntitlement(result);
          U.toast("Thank you! Your plan is updating.");
        } catch (e) {
          U.toast("That purchase didn't go through. Nothing was charged.");
        }
        return;
      }
      if (provider === "stripe") {
        const link = ((CFG.billing.stripe || {}).paymentLinks || {})[key];
        if (!link) {
          U.toast("Subscriptions aren't set up yet on this server.");
          return;
        }
        const uid = GA.Account && GA.Account.userId();
        if (!uid) {
          U.toast("Please sign in first so your plan follows you everywhere.");
          GA.App.openAuth("signup");
          return;
        }
        const url = new URL(link);
        url.searchParams.set("client_reference_id", uid);
        const email = Store.doc("profile").email;
        if (email) url.searchParams.set("prefilled_email", email);
        window.location.href = url.toString();
        return;
      }
      U.toast("Purchases aren't available in this build.");
    },

    async restore() {
      if (Plans.provider() === "native" && window.GrandmaNative.restorePurchases) {
        try {
          const result = await window.GrandmaNative.restorePurchases(GA.Account && GA.Account.userId());
          if (result && result.plan) Plans.applyEntitlement(result);
        } catch (e) {
          U.toast("We couldn't restore purchases right now. Try again in a moment.");
          return;
        }
      }
      if (GA.Account && GA.Account.signedIn()) {
        await GA.Account.refreshSubscription();
        U.toast(`You're on ${Plans.current().name}.`);
      } else if (Plans.provider() !== "native") {
        U.toast("Sign in with the account you subscribed with to restore your plan.");
        GA.App.openAuth("login");
      }
    },

    manage() {
      if (Plans.demo()) {
        Store.setDoc("subscription", { plan: "free", status: "active", period: "", renewsAt: null, source: "demo" });
        U.toast("Demo mode: back on the Free plan.");
        return;
      }
      if (Plans.provider() === "native" && window.GrandmaNative.manageSubscriptions) {
        window.GrandmaNative.manageSubscriptions();
        return;
      }
      const portal = ((CFG.billing || {}).stripe || {}).customerPortalUrl;
      if (portal) window.open(portal, "_blank", "noopener");
      else GA.App.go("pricing");
    },

    /* Native wrappers report entitlements here; the server still verifies. */
    applyEntitlement(ent) {
      if (!ent || !PLANS[ent.plan]) return;
      Store.setDoc("subscription", {
        plan: ent.plan,
        status: ent.status || "active",
        period: ent.period || "",
        renewsAt: ent.renewsAt || null,
        source: "native",
      });
    },
  };

  GA.Plans = Plans;
})();
