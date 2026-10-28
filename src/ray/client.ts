import type { RayAdvice, RayInput } from './types';
export const rayAvailable = false;
export async function requestRay(_input: RayInput, _signal: AbortSignal): Promise<RayAdvice> { throw new Error('Ask Ray is available in the hosted Pete app.'); }
