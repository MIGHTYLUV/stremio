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

const CACHE_MAX_AGE     = 3600;      // 1 hour — streams found
const CACHE_MAX_AGE_EMPTY = 900;     // 15 min — no streams found (retry sooner)
const STALE_REVALIDATE  = 14400;     // 4 hours
const STALE_ERROR       = 604800;    // 7 days

const manifest = {
  id: 'com.stremio.4k-streams',
  version: '1.0.0',
  name: '4K Stremio',
  description:
    'Aggregates 4K streams from Daher Movies (direct HTTP) and ThePirateBay (magnet). ' +
    'Prioritizes 4K → 1080p, English/Hindi, with rich quality details (HDR, codec, audio, size, seeders).',
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

  // id may be "tt1234567" for movies or "tt1234567:1:2" for series
  const parts = id.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;

  console.log(`\n[stream] ${type} ${id}`);

  // 1. Resolve title/year — if Cinemeta is down, return empty (never crash)
  let meta;
  try {
    meta = await getMetadata(imdbId, type, season, episode);
  } catch (err) {
    console.error(`[stream] metadata error for ${imdbId}: ${err.message}`);
    return { streams: [], cacheMaxAge: CACHE_MAX_AGE_EMPTY };
  }
  if (!meta || !meta.title) {
    console.log(`[stream] no metadata for ${imdbId}, skipping`);
    return { streams: [], cacheMaxAge: CACHE_MAX_AGE_EMPTY };
  }
  console.log(`[stream] resolved: "${meta.title}" (${meta.year || '?'})` +
    (season ? ` S${season}E${episode}` : ''));

  // 2. Fetch from both providers in parallel — allSettled so one failure doesn't kill the other
  const [daherResult, tpbResult] = await Promise.allSettled([
    fetchDaherStreams(meta, season, episode),
    fetchTpbStreams(meta, season, episode)
  ]);

  const daherRaw = daherResult.status === 'fulfilled' ? daherResult.value : [];
  const tpbRaw   = tpbResult.status === 'fulfilled'   ? tpbResult.value   : [];

  if (daherResult.status === 'rejected') {
    console.warn(`[daher] failed: ${daherResult.reason}`);
  }
  if (tpbResult.status === 'rejected') {
    console.warn(`[tpb] failed: ${tpbResult.reason}`);
  }

  console.log(`[stream] daher=${daherRaw.length} tpb=${tpbRaw.length}`);

  // 3. Sort (4K first) then format
  const sorted = sortStreams([...daherRaw, ...tpbRaw]);
  const streams = sorted.map(formatStream);

  const elapsed = Date.now() - startedAt;
  console.log(`[stream] returning ${streams.length} streams in ${elapsed}ms`);

  return {
    streams,
    cacheMaxAge: streams.length ? CACHE_MAX_AGE : CACHE_MAX_AGE_EMPTY,
    staleRevalidate: STALE_REVALIDATE,
    staleError: STALE_ERROR
  };
});

module.exports = builder.getInterface();
