# Lift — Frozen theme tokens (spec §8.0 outcome)

Two themes, user-switchable in Settings. One accent max per theme. Tabular numerals everywhere.

## Volt (DEFAULT — decided Jul 2026)
- bg: #000000 (true OLED black)
- surface: #0A0A0A
- border: #222222 · border-strong: #333333 · hairline: #161616
- text: #F2F2F2 · muted: #6B6B6B · dim: #4A4A4A · secondary: #9A9A9A
- accent: #C8FF2E · on-accent: #000000
- font: JetBrains Mono (400/700/800), uppercase labels, letterspacing 0.08–0.18em
- radius: 4px (small) / 6px (cards, buttons)
- numerals: JetBrains Mono 800, tabular-nums

## Ember
- bg: #17120E
- surface: #221B13 · raised: #2E251A · inset: #1E1710 / #1B140E
- border: #2E261D
- text: #F5EDE3 · bright: #FFF9F0 · muted: #9A8B78 · dim: #6E6153
- accent: #FF6A2B · on-accent: #1A0F05 · accent-muted (reason lines): #C08A5A
- font: Archivo (400/600/700/800), sentence case
- radius: 12–20px (soft)
- numerals: Archivo 800, tabular-nums

## Shared rules (route-independent, §8.2)
- ≥48px touch targets; primary actions bottom third
- Steppers 52–56px; log button 56–68px full width
- Motion: 150–250ms ease-out, transform/opacity only
- No spinners/skeletons ever; no tab bar in runner

## PWA manifest (follows default theme)
- theme_color / background_color: #000000 (Volt bg)
- display: standalone, portrait; name "Lift"
- icons: assets/icon-1024.png · assets/icon-180.png (apple-touch)
