import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const target = join(import.meta.dir, '..', 'public', 'ocr');
const modules = join(import.meta.dir, '..', 'node_modules');
await Promise.all(['core', 'lang'].map(folder => mkdir(join(target, folder), { recursive: true })));
await copyFile(join(modules, 'tesseract.js/dist/worker.min.js'), join(target, 'worker.min.js'));
const core = join(modules, 'tesseract.js-core');
for (const name of await readdir(core)) {
  if (/\.wasm(?:\.js)?$/.test(name)) await copyFile(join(core, name), join(target, 'core', name));
}
for (const language of ['eng', 'deu']) {
  await copyFile(join(modules, '@tesseract.js-data', language, '4.0.0_best_int', `${language}.traineddata.gz`), join(target, 'lang', `${language}.traineddata.gz`));
}
await copyFile(join(modules, 'tesseract.js/LICENSE.md'), join(target, 'LICENSE-tesseract.txt'));
await copyFile(join(core, 'LICENSE'), join(target, 'LICENSE-core.txt'));
console.log('Prepared same-origin OCR worker, engine, and English/German language data.');
