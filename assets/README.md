# Pete icon artwork

`pete-glow-master.png` is the approved glowing Pete artwork. Generate web favicon,
Apple touch and PWA exports with `bun run prepare:icons` using Expo's existing
image utilities. The exports are committed under `public/icons/`.

The maskable variant places the artwork at 75% of the canvas so the ring and halo
fit inside the launcher's central safe area. The normal PNG and ICO exports
preserve the full composition. These are web app icons; the in-app wordmark keeps
its existing vector artwork.
