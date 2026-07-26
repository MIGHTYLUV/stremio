# 4K Stremio Addon

Aggregates **4K** and **1080p** streams from two sources:

| Source | Type | How |
|--------|------|-----|
| **Daher Movies** (`a.111477.xyz`) | Direct HTTP (Proxy) | Resolves directory listings via `p.111477.xyz/bulk?u=` proxy |
| **ThePirateBay** (`apibay.org`) | Magnet / torrent | JSON API search by title (`cat=207/208`) |

## Features

- **4K priority, 1080p fallback** — shows 2160p streams first; if none exist, shows 1080p
- **English & Hindi only** — excludes French, Spanish, German, etc.; accepts no-tag files as English
- **Rich stream details** — resolution, source (Remux/WEB-DL/BluRay), codec (HEVC/AVC/AV1), audio (TrueHD Atmos 7.1 / DDP 5.1), HDR (DV/HDR10+/HDR10), file size, seeders
- **Movies + TV Series** via Stremio's `tt:season:episode` ID format
- **Fuzzy title matching** for Daher (handles colons, articles, special characters)
- **Rate-limited** requests to avoid rate limits from Daher
- **Cached** Cinemeta metadata (6h TTL) to reduce API calls

## Quick Start

```bash
# Install dependencies
npm install

# Start the addon
npm start
```

Then in Stremio: **Settings → Add-ons → Community** → enter:
```
http://127.0.0.1:7000/manifest.json
```

## Stream Display

Each stream shows rich quality information:

```
🎬 Dahmer 4K
📺 4K | Remux
🎥 HEVC | 10bit | HDR10+ | DV
🔊 TrueHD Atmos 7.1
💾 ~45.2 GB
🏷️ CiNEPHiLES
```

```
🏴‍☠️ TPB 4K
📺 4K | WEB-DL
🎥 H.265 | HDR10+
🔊 DDP 5.1
💾 12.3 GB
👤 245 seeders
🏷️ BYNDR
```

## Architecture

```
index.js              ← Entry point (serveHTTP, no Express)
addon.js              ← Manifest + stream handler
lib/
├── metadata.js       ← Cinemeta resolver (cached, rate-limited)
├── daher.js          ← Daher scraper (fuzzy match, proxy URL, lang filter)
├── tpb.js            ← TPB searcher (cat 207/208, year validation)
└── streamFormatter.js← Title formatting + sort
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | HTTP server port |

## License

MIT
