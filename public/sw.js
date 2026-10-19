// Minimal service worker so StockWise can be installed as an app.
// It deliberately caches nothing: prices must always come fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
