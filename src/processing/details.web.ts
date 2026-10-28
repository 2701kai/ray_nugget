import { type CaptureContext } from '../domain/requirements';
import { detailsSource, type CapturedDetails } from '../domain/details';
import { accessToken } from '../session.web';
import { gateway } from './voice.web';

export async function extractDetails(text: string, kind: 'voice' | 'card', signal: AbortSignal, context: CaptureContext = { version: 1, request: {}, questions: [] }): Promise<CapturedDetails & { engine: string }> {
  if (!text.trim()) return { fields: {}, questions: [kind === 'card' ? 'The card was not readable. Try another photo or say the details.' : 'No speech was found. Try another voice note.'], engine: 'No readable source' };
  if (text.length > 50_000) throw new Error('This source is too long to process. Add a shorter voice note.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(detailsSource(kind, text, context)));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const deadline = Date.now() + 95_000;
  do {
    const token = await accessToken();
    const response = await fetch(`${gateway}/extractions/${id}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text, kind, context }) });
    const data = await response.json() as { state?: string; result?: CapturedDetails; engine?: string; error?: string };
    if (!response.ok) throw new Error(data.error || 'Automatic filling is temporarily unavailable. The source is saved.');
    if (data.state === 'complete' && data.result && data.engine) return { ...data.result, engine: data.engine };
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new Error('Processing stopped.')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 3000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  } while (Date.now() < deadline);
  throw new Error('Pete is still reading the details. It will check again shortly.');
}
