import type { Processor } from './runner';
import type { Attachment } from '../domain/draft';
export const supportedKinds: Attachment['kind'][] = [];

// Native capture remains available while native processors are selected/tested.
export function createProcessor(): Processor {
  return { kinds: supportedKinds, async process() { throw new Error('Text extraction is not configured on this device.'); }, async close() {} };
}
