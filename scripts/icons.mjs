// Generates the PWA icon PNGs using sharp.
// Run inside Docker (never on the host):  npm run icons
// Master preference: public/icons/icon-source.png (the real brand asset from
// the design project) when present, else rendered from icon.svg (stand-in).
// Every size is derived from that master so what ships is exactly what CI
// precaches. Generated PNGs are committed so the deploy pipeline never needs
// sharp.
import sharp from 'sharp'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const out = (name) => join(iconsDir, name)

const sourcePng = join(iconsDir, 'icon-source.png')
const master = existsSync(sourcePng)
  ? await sharp(readFileSync(sourcePng)).resize(1024, 1024).png().toBuffer()
  : await sharp(readFileSync(join(iconsDir, 'icon.svg')), { density: 384 })
      .resize(1024, 1024)
      .png()
      .toBuffer()
await sharp(master).toFile(out('icon-1024.png'))

// Plain square icons derived from the master.
for (const size of [512, 192, 180]) {
  await sharp(master).resize(size, size).png().toFile(out(`icon-${size}.png`))
}

// Maskable 512: content scaled into the 80% safe zone on a full-bleed black bg.
const safe = Math.round(512 * 0.8)
const pad = Math.round((512 - safe) / 2)
const inner = await sharp(master).resize(safe, safe).png().toBuffer()
await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#000000' },
})
  .composite([{ input: inner, top: pad, left: pad }])
  .png()
  .toFile(out('icon-512-maskable.png'))

console.log('icons: wrote icon-1024, icon-512, icon-192, icon-180, icon-512-maskable')
