/**
 * Indian 4K & Dual-Audio Provider — 4KHDHub & OlaMovies
 *
 * Scrapes 4KHDHub (`4khdhub.one` / `4khdhub.dad`) and OlaMovies (`v3.olamovies.mov`)
 * using cloudscraper to bypass Cloudflare protection and resolve direct 4K Cloudflare Worker streams.
 */
const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');
const { parse: parseTorrentTitle } = require('parse-torrent-title');
const Bottleneck = require('bottleneck');

const BASE_4KHDHUB = 'https://4khdhub.one';

const limiter = new Bottleneck({ minTime: 1000, maxConcurrent: 2 });

function detectResolution(name) {
  if (/\b(2160p|4k|uhd)\b/i.test(name || '')) return 2160;
  if (/\b(1080p|fhd)\b/i.test(name || '')) return 1080;
  if (/\b(720p)\b/i.test(name || '')) return 720;
  return 0;
}

function detectSource(name) {
  const t = (name || '').toLowerCase();
  if (/remux/.test(t)) return 'remux';
  if (/web-?dl/.test(t)) return 'web-dl';
  if (/web-?rip|webrip/.test(t)) return 'webrip';
  if (/blu-?ray|bluray/.test(t)) return 'bluray';
  if (/bd-?rip|br-?rip/.test(t)) return 'bdrip';
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
    src === 'bdrip'  ? 40 : 0;
  return resScore + srcScore;
}

function estimateSizeGB(text) {
  if (!text) return null;
  let m = text.match(/(\d+(?:\.\d+)?)\s*GB\b/i);
  if (m) return parseFloat(m[1]);
  m = text.match(/(\d+(?:\.\d+)?)\s*MB\b/i);
  if (m) return parseFloat(m[1]) / 1024;
  return null;
}

async function resolveHubCloudStream(hubcloudUrl) {
  try {
    const html1 = await limiter.schedule(() => cloudscraper.get({
      url: hubcloudUrl,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }));
    const $1 = cheerio.load(html1);

    const genLink = $1('a[href*="hubcloud.php"]').attr('href');
    if (!genLink) return null;

    const html2 = await limiter.schedule(() => cloudscraper.get({
      url: genLink,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': hubcloudUrl
      }
    }));
    const $2 = cheerio.load(html2);

    let directUrl = null;
    let titleText = $2('title').text().trim() || $1('title').text().trim();

    $2('a').each((_, el) => {
      const href = $2(el).attr('href');
      const text = $2(el).text().trim();
      if (href && (href.includes('workers.dev') || href.includes('.mkv') || href.includes('.mp4') || href.includes('pixel'))) {
        directUrl = href;
        if (text && text.includes('GB')) {
          titleText += ` [${text}]`;
        }
      }
    });

    if (directUrl) {
      return { url: directUrl, title: titleText };
    }
  } catch (err) {
    console.warn(`[indian4k] HubCloud resolve failed for ${hubcloudUrl}: ${err.message}`);
  }
  return null;
}

async function fetchIndian4kStreams(meta, season, episode) {
  const title = meta.title;
  const isSeries = meta.type === 'series' && season && episode;
  const searchQuery = isSeries ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : title;

  console.log(`[indian4k] searching 4KHDHub for: "${searchQuery}"`);
  const searchUrl = `${BASE_4KHDHUB}/?s=${encodeURIComponent(searchQuery)}`;

  try {
    const searchHtml = await limiter.schedule(() => cloudscraper.get({
      url: searchUrl,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }));

    const $ = cheerio.load(searchHtml);
    let postUrl = null;

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && href.includes('-movie-') && !postUrl) {
        if (text.toLowerCase().includes(title.toLowerCase()) || href.toLowerCase().includes(title.toLowerCase())) {
          postUrl = href.startsWith('http') ? href : `${BASE_4KHDHUB}${href}`;
        }
      }
    });

    if (!postUrl) {
      console.log(`[indian4k] no post found for "${searchQuery}"`);
      return [];
    }

    console.log(`[indian4k] fetching detail page: ${postUrl}`);
    const postHtml = await limiter.schedule(() => cloudscraper.get({
      url: postUrl,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }));

    const $$ = cheerio.load(postHtml);
    const hubcloudLinks = [];

    $$('a[href*="hubcloud"]').each((_, el) => {
      const href = $$(el).attr('href');
      if (href) hubcloudLinks.push(href);
    });

    console.log(`[indian4k] found ${hubcloudLinks.length} HubCloud link(s)`);
    const resolvedStreams = [];

    // Resolve top 3 HubCloud links in parallel
    const resolvePromises = hubcloudLinks.slice(0, 3).map((link) => resolveHubCloudStream(link));
    const results = await Promise.allSettled(resolvePromises);

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const item = r.value;
        const name = item.title || title;
        const parsed = parseTorrentTitle(name) || {};
        resolvedStreams.push({
          provider: '4khdhub',
          url: item.url,
          name: name,
          parsed: parsed,
          sizeGB: estimateSizeGB(name),
          score: computeScore(parsed, name)
        });
      }
    }

    console.log(`[indian4k] returning ${resolvedStreams.length} direct stream(s)`);
    return resolvedStreams;
  } catch (err) {
    console.warn(`[indian4k] search failed: ${err.message}`);
    return [];
  }
}

module.exports = { fetchIndian4kStreams };
