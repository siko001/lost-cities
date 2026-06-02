const CACHE_NAME = "lost-expeditions-v1";
const APP_SHELL = [
  "/",
  "/local",
  "/demo",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/assets/asset-sheet.png",
  "/assets/cards/card-back.png",
  "/assets/cards/red.png",
  "/assets/cards/blue.png",
  "/assets/cards/green.png",
  "/assets/cards/yellow.png",
  "/assets/cards/white.png",
  "/assets/ui/btn-draw.png",
  "/assets/ui/btn-end.png",
  "/assets/ui/btn-play.png",
  "/assets/ui/discard-sign.png",
  "/assets/ui/score-opponent.png",
  "/assets/ui/score-you.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((cacheName) => cacheName !== CACHE_NAME).map((cacheName) => caches.delete(cacheName)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/local"));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  await cacheNextStaticAssets(cache, ["/", "/local", "/demo"]);
}

async function cacheNextStaticAssets(cache, pages) {
  const assetUrls = new Set();

  for (const page of pages) {
    try {
      const response = await fetch(page, { cache: "no-store" });
      if (!response.ok) continue;

      await cache.put(page, response.clone());
      const html = await response.text();
      const matches = html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g);

      for (const match of matches) {
        assetUrls.add(new URL(match[1], self.location.origin).toString());
      }
    } catch {
    }
  }

  await Promise.all(
    Array.from(assetUrls).map((assetUrl) =>
      cache.add(assetUrl).catch(() => {
      })
    )
  );
}

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }

    return new Response("Lost Expeditions is offline and this screen was not cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
