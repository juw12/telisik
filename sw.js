// Offline shell for Sumber. It only ever handles this site's own files: requests to the source APIs
// are not touched, not cached and not seen here.
//
// Network first, cache as the fallback, so a new release shows up on the next load and the page
// still opens with no connection. Requests are made for the bare path, so a "?q=" address typed by
// an older bookmark never leaves the browser a second time.

const CACHE = "sumber-shell-v1";
const NETWORK_WAIT_MS = 3000;
const SHELL = [
  "./",
  "index.html",
  "about.html",
  "css/style.css",
  "js/theme.js",
  "js/app.js",
  "js/config.js",
  "js/engine.js",
  "js/query.js",
  "js/sources.js",
  "js/rank.js",
  "js/text.js",
  "js/cite.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

function fromNetwork(bareUrl) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("slow network")), NETWORK_WAIT_MS);
    fetch(bareUrl, { cache: "no-cache", credentials: "omit" }).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function respond(request) {
  const url = new URL(request.url);
  const bareUrl = url.origin + url.pathname;
  const cache = await caches.open(CACHE);
  try {
    const response = await fromNetwork(bareUrl);
    if (response.ok) {
      cache.put(bareUrl, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(bareUrl);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const home = await cache.match(new URL("index.html", self.registration.scope).href);
      if (home) {
        return home;
      }
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(respond(request));
});
