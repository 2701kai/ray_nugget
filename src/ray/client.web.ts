import { accessToken } from '../session.web';
import { gateway } from '../processing/voice.web';
import { digest } from '../backup/digest';
import { parseRayAdvice, rayInputText, type RayAdvice, type RayInput } from './types';
export const rayAvailable = !!process.env.EXPO_PUBLIC_PROCESSING_URL;
export async function requestRay(input: RayInput, signal: AbortSignal): Promise<RayAdvice> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Ask Ray when you are online. Recording and saving on this device still work.');
  const body = rayInputText(input);
  const id = await digest(new TextEncoder().encode(body));
  const combined = AbortSignal.any([signal, AbortSignal.timeout(110000)]);
  for (;;) {
    const token = await accessToken();
    const response = await fetch(`${gateway}/ray/${id}`, { method: 'POST', signal: combined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ray is temporarily unavailable. Your visitor is saved.');
    if (data.state === 'complete') {
      const result = parseRayAdvice(data.result);
      if (result.id !== id || result.draftId !== input.draftId || result.sourceFingerprint !== input.sourceFingerprint) throw new Error('Ray returned advice for a different request. Please retry.');
      return result;
    }
    if (data.state !== 'processing') throw new Error('Ray returned an incomplete answer. Please retry.');
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new Error('Ray request stopped.')); };
      const timer = setTimeout(() => { combined.removeEventListener('abort', cancel); resolve(); }, 2000);
      combined.addEventListener('abort', cancel, { once: true }); if (combined.aborted) cancel();
    });
  }
}
