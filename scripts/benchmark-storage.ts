import { chromium, webkit } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';

const browserName = process.env.PETE_BENCH_BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(browserName)) throw new Error('PETE_BENCH_BROWSER must be chromium or webkit.');
const cpuRate = Number(process.env.PETE_BENCH_CPU_RATE || 1);
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) throw new Error('CPU rate must be between 1 and 20.');
if (browserName === 'webkit' && cpuRate !== 1) throw new Error('CPU throttling is only supported for Chromium.');
const samples = 20;
const build = await Bun.build({ entrypoints: ['benchmarks/storage.browser.ts'], target: 'browser', minify: true });
if (!build.success) throw new Error(build.logs.join('\n'));
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  return new URL(request.url).pathname === '/benchmark.js'
    ? new Response(build.outputs[0], { headers: { 'Content-Type': 'application/javascript' } })
    : new Response('<script type="module" src="/benchmark.js"></script>', { headers: { 'Content-Type': 'text/html' } });
} });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await (browserName === 'webkit' ? webkit : chromium).launch({ executablePath: browserName === 'webkit' ? process.env.PETE_WEBKIT_EXECUTABLE : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const context = await browser.newContext();
  const page = await context.newPage();
  if (browserName === 'chromium' && cpuRate !== 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => 'peteBenchmark' in window);
  const results = [];
  for (const visitors of [50, 500]) for (const fallback of [false, true]) {
    const result = await page.evaluate(async ({ visitors, fallback, samples }) => {
      const benchmark = (window as unknown as { peteBenchmark: typeof import('../benchmarks/storage.browser').measureStorage }).peteBenchmark;
      return benchmark(visitors, fallback, samples);
    }, { visitors, fallback, samples });
    results.push(result);
    console.log(`${visitors} visitors / ${fallback ? 'fallback' : 'indexed'}: idle p95 ${result.idleMs.p95.toFixed(1)} ms; save 1 MiB p95 ${result.saveMs.p95.toFixed(1)} ms`);
  }
  const report = { at: new Date().toISOString(), browser: browserName, version: browser.version(), environment: { platform: process.platform, arch: process.arch, cpuModel: cpus()[0]?.model }, cpuRate, samples, targetMs: { idleP95: 50, saveP95: 250 }, results };
  await mkdir('runs/performance', { recursive: true });
  const path = `runs/performance/storage-${browserName}-${cpuRate}x-${Date.now()}.json`;
  await Bun.write(path, JSON.stringify(report, null, 2));
  console.log(`Saved ${path}. Lab measurements only; not physical-phone results.`);
  if (process.env.PETE_BENCH_ENFORCE === '1' && results.some(result => result.idleMs.p95 > report.targetMs.idleP95 || result.saveMs.p95 > report.targetMs.saveP95)) {
    throw new Error('Provisional lab latency budget exceeded. Inspect the report; this is not a phone SLA.');
  }
} finally { await browser?.close(); server.stop(true); }
