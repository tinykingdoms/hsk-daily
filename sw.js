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
  "js/reading.js",
  "js/writing.js",
  "js/store.js",
  "data/sequence.json",
  "data/order.json",
  "data/cloze.json",
  "data/writing.json",
  "data/reading.json",
  "data/wrules.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    // reload 는 브라우저 캐시를 건너뛰고 서버에서 받는다. 옛 파일을 캐시에 담지 않는다.
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
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

// 먼저 망에서 받고, 안 되면 캐시로 간다.
//
// no-cache 를 붙이는 이유는 브라우저가 따로 들고 있는 캐시 때문이다. 깃허브
// Pages 가 보내는 유효 기간 안에서는 망에 나가는 척하면서 옛 파일을 그냥 준다.
// 고친 것이 안 내려가는 자리가 거기다. 서버에 바뀐 게 없으면 304 라서 비싸지 않다.
function freshFetch(req) {
  // 주소창으로 들어온 요청은 Request 를 다시 만들 수 없다. 주소로만 받아 온다.
  try {
    if (req.mode === "navigate") return fetch(req.url, { cache: "no-cache" });
    return fetch(req, { cache: "no-cache" });
  } catch (err) {
    return fetch(req);
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    freshFetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
