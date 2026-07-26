/**
 * Stream formatting — turn raw provider objects into Stremio's stream shape.
 */
const { TRACKERS } = require('./tpb');

function qualityLabel(score) {
  if (score >= 1000) return '4K';
  if (score >= 500)  return '1080p';
  if (score >= 100)  return '720p';
  return 'SD';
}

function detectCodec(p, name) {
  const t = (name || '') + ' ' + (p && p.codec ? String(p.codec) : '');
  if (/\b(hevc|x265|h\.?265|h265)\b/i.test(t)) return 'HEVC';
  if (/\b(avc|x264|h\.?264|h264)\b/i.test(t)) return 'AVC';
  if (/\b(av1)\b/i.test(t)) return 'AV1';
  if (/\b(vp9)\b/i.test(t)) return 'VP9';
  if (/\b(vp8)\b/i.test(t)) return 'VP8';
  if (/\b(xvid|divx)\b/i.test(t)) return 'XviD';
  if (/\b(mpeg2|mpeg-2)\b/i.test(t)) return 'MPEG-2';
  if (p && p.codec) return String(p.codec).toUpperCase();
  return null;
}

function detectAudio(p, name) {
  const t = (name || '') + ' ' + (p && p.audio ? String(p.audio) : '');
  const patterns = [
    /(TrueHD[\s.\-]?Atmos[\s.\-]?\d\.\d)/i,
    /(TrueHD[\s.\-]?Atmos)/i,
    /(TrueHD[\s.\-]?\d\.\d)/i,
    /(TrueHD)/i,
    /(DTS[\s\-]?HD[\s.\-]?MA[\s.\-]?\d\.\d)/i,
    /(DTS[\s\-]?HD[\s.\-]?MA)/i,
    /(DTS[\s\-]?HD[\s.\-]?\d\.\d)/i,
    /(DTS[\s\-]?HD)/i,
    /(DTS[\s.\-]?\d\.\d)/i,
    /(Atmos[\s.\-]?\d\.\d)/i,
    /(Atmos)/i,
    /(DDP[\s+.\-]?\d\.\d)/i,
    /(DD\+[\s.\-]?\d\.\d)/i,
    /(EAC3[\s.\-]?\d\.\d)/i,
    /(EAC3)/i,
    /(DD[\s+.\-]?\d\.\d)/i,
    /(AC3[\s.\-]?\d\.\d)/i,
    /(AC3)/i,
    /(OPUS[\s.\-]?\d\.\d)/i,
    /(OPUS)/i,
    /(FLAC[\s.\-]?\d\.\d)/i,
    /(FLAC)/i,
    /(AAC[\s.\-]?\d\.\d)/i,
    /(AAC)/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      let v = m[1].replace(/\s+/g, ' ').trim();
      v = v.replace(/([A-Za-z])[.\-]+(?=[A-Za-z])/g, '$1 ');
      v = v.replace(/(DD(?:\+)?)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(DDP)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(AC3)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(EAC3)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(OPUS)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(TrueHD)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(DTS)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(FLAC)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/(AAC)\s*[.\-]*\s*(\d\.\d)/i, '$1 $2');
      v = v.replace(/([A-Za-z])[.\-]+(\d)/g, '$1 $2');
      v = v.replace(/\s+/g, ' ').trim();
      return v;
    }
  }
  return null;
}

function detectHdr(p, name) {
  const parts = [];
  const t = name || (p && p.title) || '';
  if (/dolby[\s.]?vision|\bDV\b/i.test(t)) parts.push('DV');
  if (/hdr10\+|hdr10p\b/i.test(t)) parts.push('HDR10+');
  else if (/\bhdr10\b/i.test(t)) parts.push('HDR10');
  else if (/\bhdr\b/i.test(t)) parts.push('HDR');
  if (/\bhlg\b/i.test(t)) parts.push('HLG');
  if (/\bsdr\b/i.test(t)) parts.push('SDR');
  if (p && p.hdr && !parts.length) parts.push(String(p.hdr));
  return [...new Set(parts)].join(' | ') || null;
}

function detectSource(p, name) {
  const t = (name || '').toLowerCase();
  if (/\bremux\b/.test(t)) return 'Remux';
  if (/\bweb-?dl\b/.test(t)) return 'WEB-DL';
  if (/\bweb-?rip|webrip\b/.test(t)) return 'WEBRip';
  if (/\bbd-?rip|br-?rip|bdrip|brrip\b/.test(t)) return 'BDRip';
  if (/\bhd-?rip|hdrip\b/.test(t)) return 'HDRip';
  if (/\bblu-?ray|bluray\b/.test(t)) return 'BluRay';
  if (p && p.source) {
    const s = String(p.source).toLowerCase();
    if (s.includes('web')) return 'WEB-DL';
    if (s.includes('webrip')) return 'WEBRip';
    if (s.includes('bdrip') || s.includes('brrip')) return 'BDRip';
    if (s.includes('hdrip')) return 'HDRip';
    if (s.includes('bluray') || s.includes('blu-ray')) return 'BluRay';
    return String(p.source);
  }
  return null;
}

function detectGroup(p, name) {
  if (p && p.group) return String(p.group);
  const m = (name || '').match(/[-.]([A-Za-z0-9]+)(?=\.[a-z0-9]{2,4}$)/i);
  if (m) return m[1];
  return null;
}

function detect10bit(name) {
  return /\b10[\s-]?bit\b/i.test(name || '');
}

function formatStream(s) {
  const p = s.parsed || {};
  const res = qualityLabel(s.score || 0);
  const src = detectSource(p, s.name);
  const cod = detectCodec(p, s.name);
  const aud = detectAudio(p, s.name);
  const h   = detectHdr(p, s.name);
  const grp = detectGroup(p, s.name);
  const is10 = detect10bit(s.name);

  const lines = [];
  if (res || src) {
    lines.push(`📺 ${[res, src].filter(Boolean).join(' | ')}`);
  }
  const videoDetails = [cod, is10 ? '10bit' : null, h].filter(Boolean);
  if (videoDetails.length) {
    lines.push(`🎥 ${videoDetails.join(' | ')}`);
  }
  if (aud) lines.push(`🔊 ${aud}`);
  if (s.sizeGB != null) lines.push(`💾 ~${s.sizeGB.toFixed(1)} GB`);
  else if (s.size)       lines.push(`💾 ${s.size}`);
  if (s.seeders != null) lines.push(`👤 ${s.seeders} seeders`);
  if (grp)               lines.push(`🏷️ ${grp}`);

  const providerTag = s.provider === 'daher' ? '🎬 Dahmer' : '🏴‍☠️ TPB';
  const qualTag = res;

  const stream = {
    name: `${providerTag} ${qualTag}`,
    title: lines.join('\n')
  };

  if (s.provider === 'daher') {
    stream.url = s.url;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
      'Referer': 'https://a.111477.xyz/',
      'Range': 'bytes=0-'
    };
    stream.headers = reqHeaders;
    stream.behaviorHints = {
      notWebReady: true,
      proxyHeaders: {
        request: reqHeaders
      }
    };
  } else {
    stream.infoHash = s.infoHash;
    stream.sources = TRACKERS.map((t) => `tracker:${t}`);
  }

  return stream;
}

function sortStreams(streams) {
  const sorted = streams.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aSeed = a.seeders || 0;
    const bSeed = b.seeders || 0;
    if (bSeed !== aSeed) return bSeed - aSeed;
    return 0;
  });

  // Filter ONLY 4K streams if 4K streams exist.
  // Fallback to 1080p / HD only if NO 4K streams exist!
  const fourKStreams = sorted.filter(s => qualityLabel(s.score) === '4K');
  if (fourKStreams.length > 0) {
    console.log(`[filter] 4K streams found (${fourKStreams.length}), returning ONLY 4K streams`);
    return fourKStreams;
  }

  console.log(`[filter] No 4K streams found (${sorted.length}), showing 1080p/HD streams`);
  return sorted;
}

module.exports = { formatStream, sortStreams };
