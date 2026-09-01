/* Service worker: приложение работает без интернета.
   VERSION ниже подставляется автоматически при запуске «ОБНОВИТЬ САЙТ.bat» —
   это отметка времени сборки. Руками менять не нужно. */
const VERSION = 'parus-20260901-191703';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

/* Внешние библиотеки кэшируем при первом успешном обращении. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Запросы к Supabase никогда не кэшируем — данные должны быть свежими. */
  if (url.hostname.endsWith('supabase.co')) return;

  /* Свои файлы: сначала сеть, при неудаче — кэш (чтобы обновления приходили сразу). */
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  /* Библиотеки с CDN: сначала кэш — быстро и работает офлайн. */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => hit))
  );
});
