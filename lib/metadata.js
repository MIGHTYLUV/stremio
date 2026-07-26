/**
 * IMDB → title/year resolution via Cinemeta (Stremio's public meta catalog).
 * Includes in-memory cache (6h TTL) to avoid re-hitting Cinemeta on repeat requests.
 */
const axios = require('axios');
const Bottleneck = require('bottleneck');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 4 });

const http = axios.create({
  baseURL: CINEMETA,
  timeout: 10000,
  headers: { 'User-Agent': '4K-Nuvio/1.0 (+stremio-addon)' }
});

// ── Cache ──────────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours
const MAX_CACHE_SIZE = 500;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.v;
}

function cacheSet(key, v) {
  cache.set(key, { v, t: Date.now() });
  // Prevent memory leak — evict oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function extractYear(releaseInfo) {
  if (!releaseInfo) return null;
  const m = String(releaseInfo).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * @param {string} imdbId  e.g. "tt1234567"
 * @param {'movie'|'series'} type
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {Promise<{title:string, year:number|null, type:string, season:number|null, episode:number|null}|null>}
 */
async function getMetadata(imdbId, type, season, episode) {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  const cacheKey = `${type}:${imdbId}`;
  let meta = cacheGet(cacheKey);

  if (!meta) {
    const url = `/meta/${type}/${imdbId}.json`;
    try {
      const resp = await limiter.schedule(() => http.get(url));
      meta = resp.data && resp.data.meta;
    } catch (err) {
      console.error(`[cinemeta] ${imdbId} → ${err.message}`);
      return null;
    }
    if (!meta || !meta.name) return null;
    cacheSet(cacheKey, meta);
  }

  return {
    title: meta.name,
    year: extractYear(meta.year || meta.releaseInfo),
    type,
    season: season || null,
    episode: episode || null
  };
}

module.exports = { getMetadata };
