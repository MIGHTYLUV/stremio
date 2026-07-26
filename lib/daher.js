/**
 * Daher Movies provider — https://a.111477.xyz
 *
 * Public file index server with nginx-style directory listings:
 *   /movies/{Title} ({Year})/            → movie files
 *   /tvs/{Title}/Season {N}/             → TV episode files
 *
 * Uses proxy URL format https://p.111477.xyz/bulk?u=... with ExoPlayer headers & Range: bytes=0-
 * as implemented in the working 4k-main provider.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { parse: parseTorrentTitle } = require('parse-torrent-title');
const Bottleneck = require('bottleneck');

const BASE = 'https://a.111477.xyz';
const PROXY_BASE = 'https://p.111477.xyz/bulk?u=';

// Rate limiting
const limiter = new Bottleneck({ minTime: 1200, maxConcurrent: 2 });

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
  }
});

// ── Language policy ────────────────────────────────────────────────────────────
const EXCLUDE_LANG_RE = /\b(FRENCH|TRUEFRENCH|SPANISH|ESPANOL|GERMAN|ITALIAN|PORTUGUESE|PORTUGUES|RUSSIAN|JAPANESE|KOREAN|CHINESE|MANDARIN|CANTONESE|ARABIC|TURKISH|DUTCH|POLISH|TAMIL|TELUGU|THAI|VIETNAMESE|INDONESIAN|MALAY|HEBREW|LATIN|CZECH|HUNGARIAN|GREEK|SWEDISH|NORWEGIAN|FINNISH|DANISH|UKRAINIAN|ROMANIAN|BULGARIAN|LATINO|CASTELLANO)\b/i;
const INCLUDE_LANG_RE = /\b(ENGLISH|ENG|HINDI|HIN|MULTI(?:LANG)?|DUAL[\s.]?AUDIO)\b/i;

const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|ts)$/i;

// ── Quality / resolution detection ────────────────────────────────────────────
function detectResolution(name) {
  if (/\b(2160p|4k|uhd)\b/i.test(name)) return 2160;
  if (/\b(1080p|full[\s.]?hd|fhd)\b/i.test(name)) return 1080;
  if (/\b(720p|hd)\b/i.test(name)) return 720;
  if (/\b(480p|sd|dvd)\b/i.test(name)) return 480;
  return 0;
}

function detectSource(name) {
  const t = name.toLowerCase();
  if (/remux/.test(t)) return 'remux';
  if (/web-?dl/.test(t)) return 'web-dl';
  if (/web-?rip|webrip/.test(t)) return 'webrip';
  if (/blu-?ray|bluray/.test(t)) return 'bluray';
  if (/bd-?rip|br-?rip|bdrip|brrip/.test(t)) return 'bdrip';
  if (/hd-?rip|hdrip/.test(t)) return 'hdrip';
  if (/hdts|cam|telesync|\bts\b/.test(t)) return 'cam';
  return null;
}

function isAcceptableLang(name) {
  if (EXCLUDE_LANG_RE.test(name) && !INCLUDE_LANG_RE.test(name)) return false;
  return true;
}

function isAcceptableFile(name) {
  return VIDEO_EXT_RE.test(name) && isAcceptableLang(name);
}

function estimateSizeGB(name) {
  let m = name.match(/(\d+(?:\.\d+)?)\s*GB\b/i);
  if (m) return parseFloat(m[1]);
  m = name.match(/(\d+(?:\.\d+)?)\s*MB\b/i);
  if (m) return parseFloat(m[1]) / 1024;
  return null;
}

// ── Proxy URL constructor matching working 4k-main provider ──────────────────
function resolveDaherProxyUrl(rawUrl) {
  let cleanUrl = rawUrl;
  if (rawUrl.includes('u=')) {
    cleanUrl = decodeURIComponent(rawUrl.split('u=')[1]);
  }
  // encodeURIComponent and convert %20 to + for proxy compatibility
  const encoded = encodeURIComponent(cleanUrl).replace(/%20/g, '+');
  return PROXY_BASE + encoded;
}

// ── Directory candidates ──────────────────────────────────────────────────────
function buildMovieDirCandidates(meta) {
  const title = meta.title;
  const year = meta.year;

  const titleVariants = [
    title,
    title.replace(/:/g, ''),
    title.replace(/:/g, ' -'),
    title.replace(/^(The|A|An) /i, '').trim(),
    title.replace(/&/g, 'and'),
    title.replace(/\s+/g, ' ').trim()
  ];

  const uniqueVariants = [...new Set(titleVariants)];
  const out = [];

  for (const t of uniqueVariants) {
    if (year) {
      out.push(`/movies/${encodeURIComponent(`${t} (${year})`)}/`);
    }
    out.push(`/movies/${encodeURIComponent(t)}/`);
  }

  if (year) {
    for (const t of uniqueVariants) {
      out.push(`/movies/${encodeURIComponent(`${t} ${year}`)}/`);
    }
  }

  return [...new Set(out)];
}

function buildSeriesDirCandidates(meta, season) {
  const title = meta.title;
  const titleVariants = [
    title,
    title.replace(/:/g, ''),
    title.replace(/:/g, ' -'),
  ];

  const s = String(season);
  const ss = s.padStart(2, '0');
  const out = [];

  for (const t of [...new Set(titleVariants)]) {
    out.push(`/tvs/${encodeURIComponent(t)}/Season ${s}/`);
    out.push(`/tvs/${encodeURIComponent(t)}/Season ${ss}/`);
    out.push(`/tvs/${encodeURIComponent(t)}/Season%20${s}/`);
    out.push(`/tvs/${encodeURIComponent(t)}/S${ss}/`);
  }

  return [...new Set(out)];
}

// ── HTML parsing ──────────────────────────────────────────────────────────────
async function fetchDir(path) {
  try {
    const resp = await limiter.schedule(() => http.get(path, { responseType: 'text' }));
    if (resp.status === 200 && typeof resp.data === 'string') return resp.data;
  } catch (err) {
    // 404 / 429 / network — fall through
  }
  return null;
}

function parseDirectoryListing(html, basePath) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href) return;
    if (href === '../' || text === 'Parent Directory' || text === '../') return;
    if (href.endsWith('/')) return;
    if (text.endsWith('/')) return;
    if (!VIDEO_EXT_RE.test(href) && !VIDEO_EXT_RE.test(text)) return;
    const cleanName = text || decodeURIComponent(href.split('/').pop() || '');
    if (!isAcceptableFile(cleanName)) return;
    const rawUrl = href.startsWith('http') ? href : new URL(href, BASE + basePath).toString();
    const proxyUrl = resolveDaherProxyUrl(rawUrl);
    out.push({ name: cleanName, url: proxyUrl, rawUrl });
  });
  return out;
}

function buildEpisodeRegex(season, episode) {
  const s = String(season);
  const e = String(episode);
  const ss = s.padStart(2, '0');
  const ee = e.padStart(2, '0');
  return new RegExp(
    `\\bS0*${ss}E0*${ee}\\b|` +
    `\\bS0*${s}E0*${e}\\b|` +
    `\\b${s}x0*${ee}\\b|` +
    `\\b${s}x0*${e}\\b|` +
    `\\bE0*${ee}\\b(?!\\d)|` +
    `\\bE0*${e}\\b(?!\\d)|` +
    `\\bEpisode\\s*0*${e}\\b`,
    'i'
  );
}

function computeScore(parsed, name) {
  const res = detectResolution(name);
  const src = detectSource(name);
  const resScore = res === 2160 ? 1000 : res === 1080 ? 500 : res === 720 ? 100 : 0;
  const srcScore =
    src === 'remux'  ? 80 :
    src === 'web-dl' ? 70 :
    src === 'bluray' ? 60 :
    src === 'bdrip'  ? 40 :
    src === 'webrip' ? 30 :
    src === 'hdrip'  ? 10 : 0;
  return resScore + srcScore;
}

async function fetchDaherStreams(meta, season, episode) {
  const candidates = [];

  if (meta.type === 'series' && season && episode) {
    for (const path of buildSeriesDirCandidates(meta, season)) {
      const html = await fetchDir(path);
      if (html) {
        const list = parseDirectoryListing(html, path);
        if (list.length) {
          candidates.push(...list);
          break;
        }
      }
    }
  } else {
    for (const path of buildMovieDirCandidates(meta)) {
      const html = await fetchDir(path);
      if (html) {
        const list = parseDirectoryListing(html, path);
        if (list.length) {
          candidates.push(...list);
          break;
        }
      }
    }
  }

  if (!candidates.length) {
    console.log('[daher] no files matched');
    return [];
  }

  let filtered = candidates;
  if (meta.type === 'series' && season && episode) {
    const epRe = buildEpisodeRegex(season, episode);
    const byEpisode = candidates.filter((c) => epRe.test(c.name));
    if (byEpisode.length) {
      filtered = byEpisode;
    }
  }

  const enriched = filtered.map((c) => {
    const parsed = parseTorrentTitle(c.name) || {};
    return {
      provider: 'daher',
      url: c.url,
      rawUrl: c.rawUrl,
      name: c.name,
      parsed,
      score: computeScore(parsed, c.name),
      sizeGB: estimateSizeGB(c.name)
    };
  });

  const fourK = enriched.filter((x) => x.score >= 1000);
  const hd1080 = enriched.filter((x) => x.score >= 500 && x.score < 1000);
  const pickFrom = fourK.length ? fourK : hd1080;
  const picks = pickFrom.length ? pickFrom : enriched;

  console.log(`[daher] ${picks.length} candidate stream(s) (4K:${fourK.length} 1080p:${hd1080.length})`);
  return picks;
}

module.exports = { fetchDaherStreams, resolveDaherProxyUrl };
