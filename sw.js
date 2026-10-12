const CACHE = 'commander-ble-lab-v1.0.0';
const SHELL = ['./', './index.html', './styles.css', './app.js', './protocol.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('commander-ble-lab-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') {
      // Keep HTML and modules on the same app version until an update is accepted.
      return await cache.match('./index.html') || fetch(event.request);
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
