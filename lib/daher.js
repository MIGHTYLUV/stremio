/**
 * Daher Movies provider — https://a.111477.xyz
 *
 * Public file index server with nginx-style directory listings:
 *   /movies/{Title} ({Year})/            → movie files
 *   /tvs/{Title}/Season {N}/             → TV episode files
 *
 * Uses proxy URL format https://p.111477.xyz/bulk?u=... with ExoPlayer headers & Range: bytes=0-
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { parse: parseTorrentTitle } = require('parse-torrent-title');
const Bottleneck = require('bottleneck');

const BASE = 'https://a.111477.xyz';
const PROXY_BASE = 'https://p.111477.xyz/bulk?u=';

// Rate limiter: 800ms min time to prevent 429 rate limits
const limiter = new Bottleneck({ minTime: 800, maxConcurrent: 2 });

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://a.111477.xyz/'
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
  const encoded = encodeURIComponent(cleanUrl).replace(/%20/g, '+');
  return PROXY_BASE + encoded;
}

// ── Targeted Directory Candidates ────────────────────────────────────────────
function buildMovieDirCandidates(meta) {
  const title = meta.title;
  const year = meta.year;
  const out = [];

  if (year) {
    out.push(`/movies/${encodeURIComponent(`${title} (${year})`)}/`);
  }
  out.push(`/movies/${encodeURIComponent(title)}/`);

  if (title.includes(':')) {
    const cleanColon = title.replace(/:/g, '');
    if (year) out.push(`/movies/${encodeURIComponent(`${cleanColon} (${year})`)}/`);
    out.push(`/movies/${encodeURIComponent(cleanColon)}/`);
  }
  if (title.includes('&')) {
    const cleanAmp = title.replace(/&/g, 'and');
    if (year) out.push(`/movies/${encodeURIComponent(`${cleanAmp} (${year})`)}/`);
    out.push(`/movies/${encodeURIComponent(cleanAmp)}/`);
  }

  return [...new Set(out)];
}

function buildSeriesDirCandidates(meta, season) {
  const title = meta.title;
  const s = String(season);
  const ss = s.padStart(2, '0');
  const out = [];

  out.push(`/tvs/${encodeURIComponent(title)}/Season ${s}/`);
  out.push(`/tvs/${encodeURIComponent(title)}/Season ${ss}/`);

  if (title.includes(':')) {
    const cleanColon = title.replace(/:/g, '');
    out.push(`/tvs/${encodeURIComponent(cleanColon)}/Season ${s}/`);
  }

  return [...new Set(out)];
}

// ── HTML parsing with HTTP 429 retry ──────────────────────────────────────────
async function fetchDir(path) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await limiter.schedule(() => http.get(path, { responseType: 'text' }));
      if (resp.status === 200 && typeof resp.data === 'string') return resp.data;
    } catch (err) {
      if (err.response && err.response.status === 429) {
        console.warn(`[daher] HTTP 429 rate limit on ${path}, retrying in 1.5s (attempt ${attempt}/2)...`);
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        break;
      }
    }
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

  console.log(`[daher] ${enriched.length} candidate stream(s) found`);
  return enriched;
}

module.exports = { fetchDaherStreams, resolveDaherProxyUrl };
