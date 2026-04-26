const CACHE_NAME = 'dvinyl-v2.5';

const STATIC_ASSETS = [
  '/',
  '/styles/tailwind.css',
  '/manifest.json',
  '/ressources/icone-192.png',
  '/ressources/icone-512.png'
];


self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});


self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      )
    )
  );
  return self.clients.claim();
});


self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  const dynamicRoutes = [
    // Auth
    '/login', '/logout', '/setup',
    // Collections
    '/collection', '/wishlist',
    '/album/', '/book/', '/dvd/', '/game/',
    // Add / confirmation
    '/add-vinyl', '/add-book', '/add-dvd', '/add-game',
    '/confirm-vinyl/', '/confirm-dvd/', '/confirm-book/', '/confirm-game/',
    '/save-vinyl', '/save-book', '/save-dvd', '/save-game',
    // Edition
    '/album/edit/', '/book/edit/', '/dvd/edit/', '/game/edit/',
    // search
    '/search-discogs', '/search-books', '/search-dvds', '/search-games',
    // internals API
    '/api/',
    // Import
    '/import/',
    // Admin
    '/admin', '/settings',
    // Backup
    '/export', '/import'
  ];

  const isDynamic = dynamicRoutes.some(route => url.pathname.startsWith(route));
  if (isDynamic) return;

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});