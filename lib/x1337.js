/**
 * 1337x & Multi-Indexer Provider — Powered by Torrentio multi-provider API
 *
 * Fetches 4K / 2160p / Remux torrent streams fanned out across:
 *   - 1337x
 *   - TorrentGalaxy
 *   - YTS
 *   - EZTV
 *   - RARBG
 */
const axios = require('axios');
const { parse: parseTorrentTitle } = require('parse-torrent-title');
const Bottleneck = require('bottleneck');

const API_BASE = 'https://torrentio.strem.fun';

const limiter = new Bottleneck({ minTime: 200, maxConcurrent: 5 });

const http = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  }
});

const EXCLUDE_LANG_RE = /\b(FRENCH|TRUEFRENCH|SPANISH|ESPANOL|GERMAN|ITALIAN|PORTUGUESE|PORTUGUES|RUSSIAN|JAPANESE|KOREAN|CHINESE|MANDARIN|CANTONESE|ARABIC|TURKISH|DUTCH|POLISH|TAMIL|TELUGU|THAI|VIETNAMESE|INDONESIAN|MALAY|HEBREW|LATIN|CZECH|HUNGARIAN|GREEK|SWEDISH|NORWEGIAN|FINNISH|DANISH|UKRAINIAN|ROMANIAN|BULGARIAN|LATINO|CASTELLANO)\b/i;
const INCLUDE_LANG_RE = /\b(ENGLISH|ENG|HINDI|HIN|MULTI(?:LANG)?|DUAL[\s.]?AUDIO)\b/i;

function isAcceptableLang(name) {
  if (EXCLUDE_LANG_RE.test(name) && !INCLUDE_LANG_RE.test(name)) return false;
  return true;
}

function detectResolution(name) {
  if (/\b(2160p|4k|uhd)\b/i.test(name)) return 2160;
  if (/\b(1080p|fhd)\b/i.test(name)) return 1080;
  if (/\b(720p)\b/i.test(name)) return 720;
  return 0;
}

function detectSource(name) {
  const t = (name || '').toLowerCase();
  if (/remux/.test(t)) return 'remux';
  if (/web-?dl/.test(t)) return 'web-dl';
  if (/web-?rip|webrip/.test(t)) return 'webrip';
  if (/blu-?ray|bluray/.test(t)) return 'bluray';
  if (/bd-?rip|br-?rip/.test(t)) return 'bdrip';
  if (/hd-?rip/.test(t)) return 'hdrip';
  return null;
}

function computeScore(parsed, name) {
  const res = detectResolution(name);
  const src = detectSource(name);
  const resScore = res === 2160 ? 5000 : res === 1080 ? 500 : res === 720 ? 100 : 0;
  const srcScore =
    src === 'remux'  ? 150 :
    src === 'web-dl' ? 100 :
    src === 'bluray' ? 80 :
    src === 'bdrip'  ? 40 :
    src === 'webrip' ? 30 :
    src === 'hdrip'  ? 10 : 0;
  return resScore + srcScore;
}

function parseSeeders(text) {
  if (!text) return 0;
  const m = text.match(/👤\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function parseSize(text) {
  if (!text) return null;
  const m = text.match(/💾\s*([\d\.]+\s*(?:GB|MB|KB))/i);
  if (m) return m[1];
  return null;
}

function parseIndexerName(text) {
  if (!text) return '1337x';
  const m = text.match(/⚙️\s*([A-Za-z0-9]+)/);
  if (m) return m[1];
  return '1337x';
}

async function fetch1337xStreams(meta, season, episode) {
  const isSeries = meta.type === 'series' && season && episode;
  const reqId = isSeries ? `${meta.imdbId}:${season}:${episode}` : meta.imdbId;
  const endpoint = `/stream/${meta.type}/${reqId}.json`;

  try {
    const resp = await limiter.schedule(() => http.get(endpoint));
    if (!resp.data || !Array.isArray(resp.data.streams)) return [];

    const seen = new Set();
    const collected = [];

    for (const item of resp.data.streams) {
      if (!item.infoHash) continue;
      const hash = item.infoHash.toLowerCase();
      if (seen.has(hash)) continue;

      const rawTitle = item.title || (item.behaviorHints && item.behaviorHints.filename) || meta.title;
      if (!isAcceptableLang(rawTitle)) continue;

      seen.add(hash);

      const parsed = parseTorrentTitle(rawTitle) || {};
      const seeders = parseSeeders(item.title);
      const sizeStr = parseSize(item.title);
      const indexer = parseIndexerName(item.title);

      collected.push({
        provider: indexer.toLowerCase() === '1337x' ? '1337x' : indexer,
        infoHash: hash,
        fileIdx: item.fileIdx,
        name: rawTitle,
        parsed,
        size: sizeStr,
        seeders,
        score: computeScore(parsed, rawTitle) + Math.min(50, Math.floor(seeders / 10))
      });
    }

    console.log(`[1337x] ${collected.length} candidate stream(s) collected`);
    return collected;
  } catch (err) {
    console.warn(`[1337x] search failed: ${err.message}`);
    return [];
  }
}

module.exports = { fetch1337xStreams };
