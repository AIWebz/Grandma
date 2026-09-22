/*
 * Grandma AI — advertising, kept modular so the provider can change later.
 *
 * Rules the app follows no matter the provider:
 *   - Only Free users see ads. Grandma+ and Grandma Pro never do.
 *   - Never inside Grandma's replies or the chat thread.
 *   - Banners only on selected screens (Recipes, Grocery List, Planner).
 *   - Interstitials only at natural transitions (switching sections), capped
 *     to once every `interstitialMinutes`, and never in the first minutes of use.
 *   - Rewarded ads are always optional ("watch an ad for 5 more messages").
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = (window.GRANDMA_CONFIG || {}).ads || {};
  const startedAt = Date.now();
  let adsenseLoaded = false;

  const provider = () => {
    if (CFG.provider === "native" && !(window.GrandmaNative && window.GrandmaNative.showBanner)) return "house";
    return CFG.provider || "none";
  };

  const HOUSE = [
    { title: "Enjoying Grandma?", text: "Grandma+ removes ads and gives her a better memory.", cta: "See plans" },
    { title: "Cooking for a crowd?", text: "Grandma Pro shares grocery lists and chores with your whole household.", cta: "See plans" },
    { title: "Talk it through", text: "Grandma+ adds voice conversations — handy with flour on your hands.", cta: "See plans" },
  ];

  const Ads = {
    enabled() {
      return GA.Plans.current().ads && provider() !== "none";
    },

    /* Fill a banner slot element (or clear it for paying members). */
    banner(slot, placement) {
      if (!slot) return;
      if (!Ads.enabled()) {
        slot.innerHTML = "";
        slot.hidden = true;
        if (window.GrandmaNative && window.GrandmaNative.hideBanner) window.GrandmaNative.hideBanner();
        return;
      }
      slot.hidden = false;
      const p = provider();
      if (p === "native") {
        slot.hidden = true;
        window.GrandmaNative.showBanner(placement);
        return;
      }
      if (p === "adsense" && CFG.adsense && CFG.adsense.client && CFG.adsense.bannerSlot) {
        if (!adsenseLoaded) {
          const s = document.createElement("script");
          s.async = true;
          s.crossOrigin = "anonymous";
          s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CFG.adsense.client);
          document.head.appendChild(s);
          adsenseLoaded = true;
        }
        slot.innerHTML = `<span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block;min-height:60px" data-ad-client="${U.esc(CFG.adsense.client)}" data-ad-slot="${U.esc(CFG.adsense.bannerSlot)}" data-ad-format="horizontal" data-full-width-responsive="true"></ins>`;
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked */ }
        return;
      }
      const h = HOUSE[Math.floor(Math.random() * HOUSE.length)];
      slot.innerHTML = `
        <div class="house-ad">
          <span class="ad-label">Sponsored · Grandma AI</span>
          <div class="house-ad-body"><strong>${U.esc(h.title)}</strong> <span>${U.esc(h.text)}</span></div>
          <button class="btn small ghost" data-route="pricing">${U.esc(h.cta)}</button>
        </div>`;
    },

    /* Called on section changes; shows an interstitial only when appropriate. */
    maybeInterstitial(from, to) {
      if (!Ads.enabled() || !from || from === to) return;
      if (from === "chat" && GA.Chat && GA.Chat.busy()) return;
      if (Date.now() - startedAt < 3 * 60000) return;
      const local = Store.doc("local");
      const gap = (CFG.interstitialMinutes || 10) * 60000;
      if (Date.now() - (local.lastInterstitial || 0) < gap) return;
      Store.setDoc("local", { lastInterstitial: Date.now() });
      if (provider() === "native" && window.GrandmaNative.showInterstitial) {
        window.GrandmaNative.showInterstitial();
        return;
      }
      if (provider() === "house") Ads.houseInterstitial();
      // AdSense has no manual interstitial API; Google's Auto ads handle
      // "vignette" placements on their own if enabled in your AdSense account.
    },

    houseInterstitial() {
      U.openSheet({
        title: "A quick word",
        body: `<div class="interstitial">
            ${U.avatar(56)}
            <p><strong>Grandma AI is free thanks to ads like this one.</strong></p>
            <p class="muted">Grandma+ removes ads, raises your daily message limit, and adds voice conversations.</p>
            <div class="sheet-actions"><button class="btn ghost" data-close>Continue</button><button class="btn primary" data-close data-route="pricing">See plans</button></div>
          </div>`,
      });
    },

    rewardedAvailable() {
      if (!CFG.rewardedEnabled || !Ads.enabled()) return false;
      return Boolean(window.GrandmaNative && window.GrandmaNative.showRewarded);
    },

    async showRewarded() {
      try {
        const ok = await window.GrandmaNative.showRewarded();
        if (ok) {
          Store.setDoc("local", { bonus: { date: U.today(), count: GA.Plans.bonus() + 5 } });
          U.toast("Thanks! You've got 5 more messages today.");
          return true;
        }
      } catch (e) { /* dismissed */ }
      return false;
    },
  };

  GA.Ads = Ads;
})();
