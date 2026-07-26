/**
 * 4K Stremio — Stremio Addon
 * Entry point. Boots the HTTP server via stremio-addon-sdk's serveHTTP.
 * No Express needed — the SDK handles routing internally.
 */
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const PORT = parseInt(process.env.PORT, 10) || 7000;

serveHTTP(addonInterface, { port: PORT })
  .then(() => {
    console.log(`\n🎬  4K Stremio addon running`);
    console.log(`   Manifest:  http://127.0.0.1:${PORT}/manifest.json`);
    console.log(`   Install:   stremio://127.0.0.1:${PORT}/manifest.json\n`);
  })
  .catch((err) => {
    console.error('Failed to start addon:', err);
    process.exit(1);
  });
