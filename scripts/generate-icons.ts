import { compositeImagesAsync, createSquareAsync, generateFaviconAsync, generateImageAsync } from '@expo/image-utils';

// Export the approved artwork without changing the mark or its glow.
// Expo already supplies these image utilities; no new runtime dependency.
const src = 'assets/pete-glow-master.png';
const output = 'public/icons';
async function resized(size: number) {
  return (await generateImageAsync({ projectRoot: process.cwd() }, {
    src, width: size, height: size, resizeMode: 'contain', removeTransparency: true,
  })).source;
}
for (const size of [16, 32, 48, 180, 192, 512]) {
  await Bun.write(`${output}/pete-glow-${size}.png`, await resized(size));
}
await Bun.write(`${output}/pete-glow.ico`, await generateFaviconAsync(Buffer.from(await Bun.file(src).arrayBuffer()), [16, 32, 48]));
// The whole ring, including its halo, fits within the 80%-diameter safe circle.
const maskable = await compositeImagesAsync({
  background: await createSquareAsync({ size: 512, color: '#0A160F' }),
  foreground: await resized(384), x: 64, y: 64,
});
await Bun.write(`${output}/pete-glow-maskable-512.png`, maskable);
console.log('Pete glow: favicon 16/32/48, Apple touch 180, PWA 192/512, maskable 512.');
