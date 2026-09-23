/*
 * Grandma AI — "Get the app": install Grandma on a phone, tablet, or computer.
 *
 * Grandma is a Progressive Web App (manifest.webmanifest + sw.js), so browsers
 * can install her like a regular app: her own icon on the home screen, dock,
 * or Start menu, a full-screen window, and offline use.
 *  - Chrome, Edge, Samsung Internet, and Android browsers offer a one-tap
 *    install (the "beforeinstallprompt" event).
 *  - iPhone/iPad and Mac Safari install through the Share / File menu, so we
 *    show short step-by-step instructions instead.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U } = GA;

  let deferred = null; // the browser's saved install prompt, when it offers one
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isSamsung = /SamsungBrowser/.test(ua);
  const isFirefox = /Firefox\//.test(ua) || /FxiOS/.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isChromium = /Chrome\//.test(ua) && !isSamsung;
  const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium|Edg\//.test(ua);
  const isPhone = isIOS || isAndroid || /Mobile/.test(ua);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-bar
    deferred = e;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
    U.toast("Grandma AI is installed ❤️ Look for her icon.");
  });

  const Install = {
    /* Already running as an installed app? */
    installed: () =>
      (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: window-controls-overlay)").matches)) ||
      navigator.standalone === true,
    available: () => !Install.installed(),
    oneTap: () => Boolean(deferred),
    deviceWord: () => (isIOS ? (/iPad/.test(ua) || !/iPhone|iPod/.test(ua) ? "iPad" : "iPhone") : isPhone ? "phone" : "computer"),
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),

    async open() {
      if (deferred) {
        const prompt = deferred;
        deferred = null;
        prompt.prompt();
        try {
          const choice = await prompt.userChoice;
          if (choice && choice.outcome !== "accepted") U.toast("No problem — you can install Grandma any time from the menu.");
        } catch (e) { /* ignore */ }
        changed();
        return;
      }
      showSteps();
    },
  };

  const step = (n, html) => `<li><span class="n">${n}</span><span>${html}</span></li>`;
  const shareIcon = `<svg class="inline-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 15.5V4M7 8.5l5-5 5 5M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/></svg>`;

  function stepsHTML() {
    if (isIOS) {
      const where = /iPhone|iPod/.test(ua) ? "at the bottom of the screen" : "at the top right";
      return `<ol class="install-steps">
          ${step(1, `Tap the <b>Share</b> button ${shareIcon} ${where}${/CriOS|FxiOS|EdgiOS/.test(ua) ? " (in Chrome, it's in the address bar)" : ""}.`)}
          ${step(2, `Scroll down and tap <b>Add to Home Screen</b>.`)}
          ${step(3, `Make sure <b>Open as Web App</b> is on (if you see it), then tap <b>Add</b>.`)}
        </ol>
        <p class="muted small">Grandma then opens from her own icon, full screen. iPhone and iPad keep an installed app's storage separate from Safari, so the first time you chat in the app she downloads her brain once more.</p>`;
    }
    if (isMacSafari) {
      return `<ol class="install-steps">
          ${step(1, `In the menu bar, click <b>File</b> → <b>Add to Dock…</b> (or the Share button ${shareIcon} → <b>Add to Dock</b>).`)}
          ${step(2, `Click <b>Add</b>. Grandma appears in your Dock and Launchpad.`)}
        </ol>
        <p class="muted small">Needs macOS Sonoma (14) or newer.</p>`;
    }
    if (isAndroid) {
      return `<ol class="install-steps">
          ${step(1, `Tap the browser menu <b>⋮</b> ${isSamsung ? "(or ☰ at the bottom)" : "at the top right"}.`)}
          ${step(2, `Tap <b>${isSamsung ? "Add page to → Home screen" : isFirefox ? "Install" : "Install app"}</b> (it may say <b>Add to Home screen</b>).`)}
          ${step(3, `Tap <b>Install</b>.`)}
        </ol>`;
    }
    if (isFirefox) {
      return `<p>Firefox on computers can't install web apps yet. Open this page in <b>Chrome</b> or <b>Edge</b> and click <b>Get the app</b> there — your recipes and lists come along if you're signed in.</p>`;
    }
    if (isEdge) {
      return `<ol class="install-steps">
          ${step(1, `Click the <b>App available</b> icon in the address bar, or the menu <b>…</b> → <b>Apps</b> → <b>Install Grandma AI</b>.`)}
          ${step(2, `Click <b>Install</b>. Grandma gets her own window, taskbar icon, and Start menu entry.`)}
        </ol>`;
    }
    if (isChromium) {
      return `<ol class="install-steps">
          ${step(1, `Click the <b>Install</b> icon at the right end of the address bar, or the menu <b>⋮</b> → <b>Cast, save, and share</b> → <b>Install page as app</b>.`)}
          ${step(2, `Click <b>Install</b>. Grandma gets her own window and a dock/taskbar icon.`)}
        </ol>`;
    }
    return `<p>Use your browser's menu and look for <b>Install app</b> or <b>Add to Home Screen</b>.</p>`;
  }

  function showSteps() {
    U.openSheet({
      title: "Get the Grandma AI app",
      body: `<div class="install">
          <div class="install-hero">${U.avatar(56)}<div><h3>Put Grandma on your ${Install.deviceWord()}</h3>
            <p class="muted">Her own icon, a full-screen window, and she works offline. Free, and nothing to download from an app store.</p></div></div>
          ${stepsHTML()}
          <div class="row"><button class="btn primary" data-close>Got it</button></div>
        </div>`,
    });
  }

  GA.Install = Install;
})();
