/**
 * Addon manifest + stream handler.
 * Aggregates 4K streams from Daher Movies, ThePirateBay, and 1337x in parallel.
 * Prioritizes 4K → 1080p fallback.
 */
const { addonBuilder } = require('stremio-addon-sdk');
const { getMetadata } = require('./lib/metadata');
const { fetchDaherStreams } = require('./lib/daher');
const { fetchTpbStreams } = require('./lib/tpb');
const { fetch1337xStreams } = require('./lib/x1337');
const { formatStream, sortStreams } = require('./lib/streamFormatter');

const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const envLabel = isVercel ? 'Vercel' : 'Render';

const manifest = {
  id: `com.stremio.4k-streams-${envLabel.toLowerCase()}`,
  version: '1.0.5',
  name: `${envLabel} 4K`,
  description:
    `Aggregates 4K streams from 1337x, Daher Movies, and ThePirateBay on ${envLabel}. ` +
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

  const [daherResult, tpbResult, x1337Result] = await Promise.allSettled([
    fetchDaherStreams(meta, season, episode),
    fetchTpbStreams(meta, season, episode),
    fetch1337xStreams(meta, season, episode)
  ]);

  const daherRaw = meFilterList(daherResult);
  const tpbRaw   = meFilterList(tpbResult);
  const x1337Raw = meFilterList(x1337Result);

  function meFilterList(res) {
    return res.status === 'fulfilled' && Array.isArray(res.value) ? res.value : [];
  }

  if (daherResult.status === 'rejected') console.warn(`[daher] failed: ${daherResult.reason}`);
  if (tpbResult.status === 'rejected')   console.warn(`[tpb] failed: ${tpbResult.reason}`);
  if (x1337Result.status === 'rejected') console.warn(`[1337x] failed: ${x1337Result.reason}`);

  console.log(`[stream] Daher=${daherRaw.length} TPB=${tpbRaw.length} 1337x=${x1337Raw.length}`);

  const sorted = sortStreams([...daherRaw, ...tpbRaw, ...x1337Raw]);
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
