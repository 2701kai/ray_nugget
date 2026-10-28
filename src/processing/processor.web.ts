import { auth } from '../session.web';
import { extractDetails } from './details.web';
import { requestCandidates } from './request';
import type { Extraction } from './jobs';
import type { Worker } from 'tesseract.js';
import type { Processor } from './runner';
import { contactCandidates } from './contact';
import type { Attachment } from '../domain/draft';
import { gateway, transcribe } from './voice.web';
export const supportedKinds: Attachment['kind'][] = gateway ? ['card', 'voice'] : ['card'];

export function createProcessor(): Processor {
  let worker: Worker | undefined;
  let closed = false;
  return {
    kinds: supportedKinds,
    isAvailable: () => navigator.onLine,
    async process(job, bytes, mimeType, signal, checkpoint, context) {
      async function source(): Promise<Extraction> {
        if (job.result) return job.result;
        if (job.kind === 'voice') return transcribe(job, bytes, mimeType, signal);
        try {
          if (!worker) {
            const { createWorker, PSM } = await import('tesseract.js');
            const loaded = await createWorker(['eng', 'deu'], 1, {
              workerPath: new URL('/ocr/worker.min.js', window.location.href).href,
              corePath: new URL('/ocr/core', window.location.href).href,
              langPath: new URL('/ocr/lang', window.location.href).href,
              errorHandler: () => undefined,
            });
            if (closed || signal.aborted) { await loaded.terminate(); throw new Error('Processing stopped.'); }
            worker = loaded;
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
          }
          const { data } = await worker.recognize(new Blob([new Uint8Array(bytes)], { type: mimeType }));
          const text = data.text.trim();
          return { text, fields: contactCandidates(text), engine: 'Tesseract 7 · English/German' };
        } catch (error) {
          await worker?.terminate(); worker = undefined;
          throw new Error(error instanceof Error ? error.message : 'Card reading failed. Check the connection to Pete, then retry.');
        }
      }
      const original = await source();
      await checkpoint?.(original);
      if (auth) return { text: original.text, ...await extractDetails(original.text, job.kind, signal, context) };
      const candidates = job.kind === 'voice' ? requestCandidates(original.text) : {};
      const request = Object.fromEntries(Object.entries(candidates).filter(([, candidate]) => candidate).map(([field, candidate]) => [field, candidate!.value]));
      return { ...original, ...(Object.keys(request).length ? { request } : {}) };
    },
    async close() { closed = true; await worker?.terminate(); worker = undefined; },
  };
}
