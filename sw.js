const CACHE_NAME = 'finanze-v6';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// Fase di Istallazione App Copia su Cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(URLS_TO_CACHE);
        })
    );
});

// Fase di Rete: Network First (Serve per testare se c'è internet per dati frerchi, se fallisce usa la Cache Locale per supportare l'App senza rete)
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).catch(function() {
            return caches.match(event.request);
        })
    );
});
