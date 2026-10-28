import { useEffect, useRef, useState } from 'react';
import { release } from './release';
import { updatesBlocked } from './pwa/updateGuard.web';
type InstallEvent = Event & { prompt(): Promise<{ outcome: string }> };

export function usePwa() {
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches);
  const [installable, setInstallable] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const prompt = useRef<InstallEvent | null>(null);
  useEffect(() => {
    let live = true, pending = false, reloading = false, lastActivity = Date.now(), checking = false;
    let registration: ServiceWorkerRegistration | undefined;
    const removers: Array<() => void> = [];
    const listen = (target: EventTarget, name: string, listener: EventListener) => {
      target.addEventListener(name, listener); removers.push(() => target.removeEventListener(name, listener));
    };
    const activity = () => { lastActivity = Date.now(); };
    const check = async () => {
      if (!registration || checking || !navigator.onLine || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        await registration.update();
        navigator.serviceWorker.controller?.postMessage({ type: 'PETE_CLIENT_READY' });
      } catch { /* Keep the installed offline app usable. */ }
      finally { checking = false; }
    };
    const controllerChanged = () => {
      if (__DEV__ || !('serviceWorker' in navigator)) return;
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); }, 2000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout); channel.port1.close();
        if (!live || worker !== navigator.serviceWorker.controller) return;
        if (typeof event.data?.build === 'string' && event.data.build !== release.build) {
          pending = true; activity(); setUpdateReady(true);
        }
      };
      worker.postMessage({ type: 'PETE_VERSION' }, [channel.port2]);
      worker.postMessage({ type: 'PETE_CLIENT_READY' });
    };
    listen(window, 'online', () => { setOnline(true); activity(); void check(); });
    listen(window, 'offline', () => setOnline(false));
    listen(window, 'focus', () => { activity(); void check(); });
    listen(document, 'visibilitychange', () => { activity(); if (document.visibilityState === 'visible') { controllerChanged(); void check(); } });
    for (const name of ['pointerdown', 'keydown', 'input', 'compositionstart', 'compositionend', 'focusin', 'focusout', 'scroll']) listen(document, name, activity);
    listen(window, 'beforeinstallprompt', event => { event.preventDefault(); prompt.current = event as InstallEvent; setInstallable(true); });
    listen(window, 'appinstalled', () => { setInstalled(true); setInstallable(false); prompt.current = null; });
    if (!__DEV__ && 'serviceWorker' in navigator) {
      listen(navigator.serviceWorker, 'controllerchange', controllerChanged);
      listen(navigator.serviceWorker, 'message', event => {
        const message = event as MessageEvent;
        if (message.data?.type === 'PETE_BUILD_QUERY') message.ports[0]?.postMessage({ build: release.build });
      });
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async value => {
        if (!live) return;
        registration = value; controllerChanged(); void check();
        await navigator.serviceWorker.ready;
        if (live) setOfflineReady(true);
      }).catch(() => { if (live) setOfflineReady(false); });
    }
    const refresh = setInterval(() => { void check(); }, 60_000);
    const idle = setInterval(() => {
      const input = document.activeElement;
      if (updatesBlocked() || document.visibilityState !== 'visible' || input?.matches('input,textarea,[contenteditable="true"]')) { activity(); return; }
      if (live && pending && !reloading && Date.now() - lastActivity >= 5000) {
        reloading = true;
        // Firebase's persistent session and committed IndexedDB drafts survive.
        // Each tab waits independently; activating a worker never reloads a form.
        window.location.reload();
      }
    }, 500);
    return () => { live = false; clearInterval(refresh); clearInterval(idle); removers.forEach(remove => remove()); };
  }, []);
  async function install() { if (prompt.current) { await prompt.current.prompt(); prompt.current = null; setInstallable(false); } }
  return { online, offlineReady, installable, installed, updateReady, install };
}
