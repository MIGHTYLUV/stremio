/**
 * ThePirateBay provider — supports apibay.org (JSON API) and thepiratebay.party (HTML mirror).
 *
 * Searches across ALL categories to ensure 4K/2160p/UHD/Remux releases are retrieved.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { parse: parseTorrentTitle } = require('parse-torrent-title');
const Bottleneck = require('bottleneck');

const API_APIBAY = 'https://apibay.org';
const API_PARTY = 'https://thepiratebay.party';

const limiter = new Bottleneck({ minTime: 300, maxConcurrent: 5 });

const httpApibay = axios.create({
  baseURL: API_APIBAY,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9'
  }
});

const httpParty = axios.create({
  baseURL: API_PARTY,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  }
});

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.bitsearch.to:1337/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'http://tracker.gbitt.info/announce',
  'http://tracker.files.fm:6969/announce'
];

const EXCLUDE_LANG_RE = /\b(FRENCH|TRUEFRENCH|SPANISH|ESPANOL|GERMAN|ITALIAN|PORTUGUESE|PORTUGUES|RUSSIAN|JAPANESE|KOREAN|CHINESE|MANDARIN|CANTONESE|ARABIC|TURKISH|DUTCH|POLISH|TAMIL|TELUGU|THAI|VIETNAMESE|INDONESIAN|MALAY|HEBREW|LATIN|CZECH|HUNGARIAN|GREEK|SWEDISH|NORWEGIAN|FINNISH|DANISH|UKRAINIAN|ROMANIAN|BULGARIAN|LATINO|CASTELLANO)\b/i;
const INCLUDE_LANG_RE = /\b(ENGLISH|ENG|HINDI|HIN|MULTI(?:LANG)?|DUAL[\s.]?AUDIO)\b/i;

function buildMagnet(infoHash, name) {
  const dn = encodeURIComponent(name);
  const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${tr}`;
}

function formatSize(bytes) {
  if (!bytes) return null;
  const n = parseInt(bytes, 10);
  if (!n || isNaN(n)) return String(bytes);
  const gb = n / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

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

async function searchApibay(query) {
  try {
    const resp = await limiter.schedule(() => httpApibay.get('/q.php', {
      params: { q: query, cat: 0 }
    }));
    if (!Array.isArray(resp.data)) return [];
    return resp.data;
  } catch (err) {
    console.warn(`[tpb:apibay] search "${query}" failed: ${err.message}`);
    return [];
  }
}

async function searchTpbParty(query) {
  try {
    const url = `/search/${encodeURIComponent(query)}/1/99/0`;
    const resp = await limiter.schedule(() => httpParty.get(url));
    const $ = cheerio.load(resp.data);
    const items = [];

    $('table#searchResult tr').each((i, el) => {
      const titleLink = $(el).find('a.detLink');
      if (!titleLink.length) return;
      const name = titleLink.text().trim();
      const magnet = $(el).find('a[href^="magnet:"]').attr('href');
      if (!magnet) return;

      const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
      if (!hashMatch) return;
      const info_hash = hashMatch[1].toLowerCase();

      const seedersText = $(el).find('td[align="right"]').eq(1).text().trim() || '0';
      const seeders = parseInt(seedersText, 10) || 0;
      const sizeText = $(el).find('td[align="right"]').eq(0).text().trim() || '';

      items.push({ info_hash, name, seeders, magnet, size: sizeText });
    });
    return items;
  } catch (err) {
    console.warn(`[tpb:party] search "${query}" failed: ${err.message}`);
    return [];
  }
}

function isPlaceholderHash(h) {
  return !h || h === '0000000000000000000000000000000000000000' || h.length !== 40;
}

function pickSeedBonus(seeders) {
  return Math.min(50, Math.floor((seeders || 0) / 10));
}

async function fetchTpbStreams(meta, season, episode) {
  const isSeries = meta.type === 'series' && season && episode;
  const sStr = String(season).padStart(2, '0');
  const eStr = String(episode).padStart(2, '0');
  
  let queries = [];
  if (isSeries) {
    queries = [
      `${meta.title} S${sStr}E${eStr} 2160p`,
      `${meta.title} S${sStr}E${eStr} 4k`,
      `${meta.title} S${sStr}E${eStr}`
    ];
  } else {
    const cleanTitle = meta.title.replace(/&/g, 'and');
    queries = [
      `${cleanTitle} 2160p`,
      `${cleanTitle} 4k`,
      `${cleanTitle} remux`,
      cleanTitle
    ];
  }

  // Fetch from apibay.org and thepiratebay.party in parallel
  const [apibayResults, partyResults] = await Promise.all([
    Promise.all(queries.map(q => searchApibay(q))),
    Promise.all(queries.map(q => searchTpbParty(q)))
  ]);

  const seen = new Set();
  const collected = [];

  function consider(item) {
    if (!item || isPlaceholderHash(item.info_hash)) return;
    const hash = item.info_hash.toLowerCase();
    if (seen.has(hash)) return;
    const name = item.name || '';
    if (!isAcceptableLang(name)) return;

    const parsed = parseTorrentTitle(name) || {};

    if (!isSeries && meta.year) {
      const yearInName = name.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearInName && parseInt(yearInName[1], 10) !== meta.year) return;
    }

    seen.add(hash);

    const seeders = parseInt(item.seeders, 10) || 0;
    collected.push({
      provider: 'tpb',
      infoHash: hash,
      magnet: item.magnet || buildMagnet(hash, name),
      name,
      parsed,
      size: formatSize(item.size),
      seeders,
      score: computeScore(parsed, name) + pickSeedBonus(seeders)
    });
  }

  apibayResults.forEach(list => list.forEach(consider));
  partyResults.forEach(list => list.forEach(consider));

  console.log(`[tpb] ${collected.length} candidate stream(s) collected`);
  return collected;
}

module.exports = { fetchTpbStreams, TRACKERS };
