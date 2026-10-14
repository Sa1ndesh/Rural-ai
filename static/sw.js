const CACHE_NAME = 'ruralx-cache-v3';
const ASSETS_TO_CACHE = [
    '/',
    '/app',
    '/auth',
    '/scanning',
    '/static/style.css',
    '/static/main.js',
    '/static/auth.css',
    '/static/scanning.css',
    '/static/scanning.js',
    '/static/supabase-client.js',
    '/static/manifest.json',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap'
];

// Install event: cache all static assets
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).catch(err => console.warn('Cache add error:', err))
    );
});

// Activate event: clear old caches if versions change
self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: Network first, fallback to cache for offline capabilities
self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;

    // Do NOT intercept external API/database calls (cross-origin)
    if (!event.request.url.startsWith(self.location.origin)) return;

    // Do not cache backend API endpoints
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);
                if (cached) return cached;
                return new Response('Offline: resource not cached', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
    );
});
