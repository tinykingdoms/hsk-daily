// 지하철에서도 열리도록 앱 껍데기와 문항 파일을 캐시에 둔다.
// 문항을 고치면 CACHE 를 올려야 새 파일이 내려간다.
const CACHE = "hsk-daily-6";

const SHELL = [
  "./",
  "index.html",
  "app.css",
  "js/app.js",
  "js/daily.js",
  "js/drill.js",
  "js/explain.js",
  "js/store.js",
  "data/sequence.json",
  "data/order.json",
  "data/cloze.json",
  "data/writing.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
