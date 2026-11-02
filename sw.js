// Réseau d'abord (pour recevoir les mises à jour), copie gardée en secours (pour marcher sans réseau).
// Changer CACHE à chaque nouvelle version publiée.
const CACHE = 'fiches-stock-1';
const FICHIERS = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icone.svg', 'icone-180.png', 'icone-192.png', 'icone-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // l'envoi au Sheet ne passe jamais par le cache
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { // polices : copie gardée
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(x => { const c = x.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return x; })));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
