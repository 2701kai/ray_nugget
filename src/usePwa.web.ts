import { useEffect, useRef, useState } from 'react';
type InstallEvent = Event & { prompt(): Promise<{ outcome: string }> };

export function usePwa() {
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches);
  const [installable, setInstallable] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const prompt = useRef<InstallEvent | null>(null);
  useEffect(() => {
    let live = true;
    const connectivity = () => setOnline(navigator.onLine);
    const beforeInstall = (event: Event) => { event.preventDefault(); prompt.current = event as InstallEvent; setInstallable(true); };
    const installed = () => { setInstalled(true); setInstallable(false); prompt.current = null; };
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    window.addEventListener('beforeinstallprompt', beforeInstall); window.addEventListener('appinstalled', installed);
    if (!__DEV__ && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(async registration => {
        if (live) setUpdateReady(!!registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => { if (live && worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true); });
        });
        await navigator.serviceWorker.ready;
        if (live) setOfflineReady(true);
      }).catch(() => { if (live) setOfflineReady(false); });
    }
    return () => {
      live = false; window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installed);
    };
  }, []);
  async function install() { if (prompt.current) { await prompt.current.prompt(); prompt.current = null; setInstallable(false); } }
  return { online, offlineReady, installable, installed, updateReady, install };
}
