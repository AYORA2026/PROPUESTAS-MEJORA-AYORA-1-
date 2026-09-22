const CACHE = "ayora-propuestas-v11";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/template-part-01.txt",
  "assets/template-part-02.txt",
  "assets/template-part-03.txt",
  "assets/template-part-04.txt",
  "assets/template-part-05.txt",
  "assets/template-part-06.txt",
  "assets/template-part-07.txt",
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const isAppFile =
    e.request.mode === "navigate" ||
    new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    isAppFile
      ? fetch(e.request, { cache: "no-store" })
          .then((r) => {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return r;
          })
          .catch(() =>
            caches
              .match(e.request)
              .then((hit) => hit || caches.match("index.html")),
          )
      : caches.match(e.request).then((hit) => hit || fetch(e.request)),
  );
});
