/**
 * Addon manifest + stream handler.
 * Resolves IMDB → metadata via Cinemeta, then fans out to Daher + TPB
 * in parallel, sorts 4K first, and returns rich-formatted streams.
 */
const { addonBuilder } = require('stremio-addon-sdk');
const { getMetadata } = require('./lib/metadata');
const { fetchDaherStreams } = require('./lib/daher');
const { fetchTpbStreams } = require('./lib/tpb');
const { formatStream, sortStreams } = require('./lib/streamFormatter');

const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const envLabel = isVercel ? 'Vercel' : 'Render';

const manifest = {
  id: `com.stremio.4k-streams-${envLabel.toLowerCase()}`,
  version: '1.0.2',
  name: `4K Stremio (${envLabel})`,
  description:
    `Aggregates 4K streams from Daher Movies and ThePirateBay (${envLabel} Host). ` +
    'Returns 4K streams if available, falling back to 1080p if 4K is not found.',
  types: ['movie', 'series'],
  catalogs: [],
  resources: ['stream'],
  idPrefixes: ['tt'],
  behaviorHints: {
    configurable: false,
    configurationRequired: false
  }
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  const startedAt = Date.now();

  const parts = id.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;

  console.log(`\n[stream] [${envLabel}] ${type} ${id}`);

  let meta;
  try {
    meta = await getMetadata(imdbId, type, season, episode);
  } catch (err) {
    console.error(`[stream] metadata error for ${imdbId}: ${err.message}`);
    return { streams: [], cacheMaxAge: 60 };
  }
  if (!meta || !meta.title) {
    console.log(`[stream] no metadata for ${imdbId}, skipping`);
    return { streams: [], cacheMaxAge: 60 };
  }
  console.log(`[stream] resolved: "${meta.title}" (${meta.year || '?'})` +
    (season ? ` S${season}E${episode}` : ''));

  const [daherResult, tpbResult] = await Promise.allSettled([
    fetchDaherStreams(meta, season, episode),
    fetchTpbStreams(meta, season, episode)
  ]);

  const daherRaw = daherResult.status === 'fulfilled' ? meFilterDaher(daherResult.value) : [];
  const tpbRaw   = tpbResult.status === 'fulfilled'   ? tpbResult.value   : [];

  function meFilterDaher(list) {
    return Array.isArray(list) ? list : [];
  }

  if (daherResult.status === 'rejected') {
    console.warn(`[daher] failed: ${daherResult.reason}`);
  }
  if (tpbResult.status === 'rejected') {
    console.warn(`[tpb] failed: ${tpbResult.reason}`);
  }

  console.log(`[stream] Daher=${daherRaw.length} TPB=${tpbRaw.length}`);

  const sorted = sortStreams([...daherRaw, ...tpbRaw]);
  const streams = sorted.map(s => formatStream(s, envLabel));

  const elapsed = Date.now() - startedAt;
  console.log(`[stream] returning ${streams.length} stream(s) in ${elapsed}ms`);

  return {
    streams,
    cacheMaxAge: 300,
    staleRevalidate: 600,
    staleError: 3600
  };
});

module.exports = builder.getInterface();
