// Service worker minimo — necessario para o navegador oferecer "Instalar app" (PWA).
// Nao faz cache offline agressivo (para nao servir versoes antigas do app);
// apenas repassa as requisicoes para a rede.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // estrategia "network only": sempre busca da rede (app sempre atualizado)
  event.respondWith(fetch(event.request).catch(() => new Response('Offline', { status: 503 })));
});
