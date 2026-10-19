// "Install app": lets the site be installed like a desktop/phone app (its own window, dock/taskbar icon).
let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  document.querySelectorAll('[data-install], #install').forEach((b) => { b.hidden = false; });
});
window.addEventListener('appinstalled', () => { deferred = null; });

export const installAvailable = () => !!deferred || !isInstalled();
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export async function promptInstall() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    return;
  }
  const ua = navigator.userAgent;
  const how = /iPhone|iPad/.test(ua) ? 'On iPhone/iPad: tap the Share button, then "Add to Home Screen".'
    : /Safari/.test(ua) && !/Chrome|Edg/.test(ua) ? 'In Safari on a Mac: File menu → "Add to Dock".'
      : /Edg/.test(ua) ? 'In Edge: click the "App available" icon in the address bar, or menu (…) → Apps → "Install this site as an app".'
        : 'In Chrome: click the install icon (a monitor with a down arrow) at the right end of the address bar, or menu ⋮ → "Cast, save, and share" → "Install page as app".';
  alert(`Install StockWise as an app\n\n${how}\n\nIt opens in its own window, so you can keep the Day Trade Desk next to your charts.`);
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
