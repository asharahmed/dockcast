self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => { const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'DockCast', { body: d.body || '', tag: d.tag, data: { url: d.url || '/' }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: !!d.tag })); });
self.addEventListener('notificationclick', e => { e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); if (c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); })); });
