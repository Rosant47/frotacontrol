const CACHE = 'frotacontrol-v116';
const STATIC = [
  '/',
  '/index.html',
  '/login.html',
  '/landing.html',
  '/signup.html',
  '/insta.html',
  '/planos.html',
  '/meu-plano.html',
  '/sucesso.html',
  '/rastreio.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/config.js',
  '/logo.jpg',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Deixa o Firebase/CDNs passarem direto (Firestore cuida do cache de dados)
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('unpkg') ||
      url.hostname.includes('cdnjs') ||
      url.hostname.includes('jsdelivr')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fromNet = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      // Cache-first para arquivos estáticos, network-first para HTML
      const isHtml = e.request.headers.get('accept')?.includes('text/html');
      return isHtml ? (fromNet || cached) : (cached || fromNet);
    })
  );
});

// Notifica abas abertas quando volta a conexão
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
