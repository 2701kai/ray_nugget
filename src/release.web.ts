import config from '../app.json';
// Read the loaded document once. A waiting service worker or newer server release
// must not change the version shown by an older, still-open page.
const metadata = (name: string) => typeof document === 'undefined' ? undefined : document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
export const release = { version: metadata('pete-version') || config.expo.version, build: metadata('pete-build') || 'dev' };
