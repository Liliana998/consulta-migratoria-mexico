// Service worker: guarda la aplicación en el dispositivo para que abra sin conexión.
// Los datos NO se guardan aquí: los conserva la copia local de Firestore.
const VERSION = "cmm-v3";
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const LOCALES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/datos.js", "js/pin.js", "js/config.js", "js/backend-firebase.js",
  "icons/icono-192.png", "icons/icono-512.png", "icons/icono-maskable-512.png"
];
const EXTERNOS = [`${SDK}/firebase-app.js`, `${SDK}/firebase-auth.js`, `${SDK}/firebase-firestore.js`];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(LOCALES);
    await Promise.all(EXTERNOS.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mismoOrigen = url.origin === self.location.origin;
  const esSdk = url.href.startsWith(SDK + "/");
  if (!mismoOrigen && !esSdk) return; // Firestore, Google y demás servicios van directos a la red.

  if (esSdk) {
    // Archivos versionados: primero la copia guardada.
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((resp) => {
      if (resp.ok) caches.open(VERSION).then((c) => c.put(req, resp.clone()));
      return resp;
    })));
    return;
  }

  // Archivos propios: siempre la copia de la versión instalada (todas las piezas coinciden).
  // Al publicar una versión nueva se cambia VERSION; el navegador la instala en la siguiente apertura con internet.
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const clave = req.mode === "navigate" ? "index.html" : req;
    const guardada = await c.match(clave, { ignoreSearch: true });
    if (guardada) return guardada;
    try { return await fetch(req); }
    catch { return new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
  })());
});
