/*
 * Grandma AI — service worker: offline app shell + notification clicks.
 * Bump VERSION when you deploy changes so returning visitors get them.
 */
const VERSION = "grandma-v8";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "config.js",
  "app.js",
  "manifest.webmanifest",
  "js/util.js",
  "js/store.js",
  "js/plans.js",
  "js/account.js",
  "js/ai.js",
  "js/actions.js",
  "js/voice.js",
  "js/ads.js",
  "js/notify.js",
  "js/recipe-ui.js",
  "js/chat.js",
  "js/views/recipes.js",
  "js/views/tasks.js",
  "js/views/grocery.js",
  "js/views/planner.js",
  "js/views/cookbook.js",
  "js/views/settings.js",
  "data/recipes.js",
  "assets/logo/avatar.png",
  "assets/logo/grandma.png",
  "assets/icons/favicon-64.png",
  "js/brain.js",
  "js/brain-worker.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    // Only remove this app's old shells — never the AI model caches (webllm/…),
    // which hold Grandma's multi-gigabyte brain.
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("grandma-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Same-origin files: serve from cache, refresh in the background.
// Everything else (AI proxy, Supabase, ads) always goes to the network.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached || (e.request.mode === "navigate" ? cache.match("index.html") : undefined));
      return cached || network;
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const route = (e.notification.data && e.notification.data.route) || "chat";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.postMessage({ route });
          return c.focus();
        }
      }
      return self.clients.openWindow("./#/" + route);
    })
  );
});
