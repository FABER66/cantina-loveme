// Cerca foto di una bottiglia sul web e restituisce qualche candidato da confermare.
// GET ?q=<nome vino>  ->  { results:[ {thumb, full, src} ], engine }
// Ordine: Google CSE (se GOOGLE_CSE_KEY+GOOGLE_CSE_CX) -> Bing (keyless) -> DuckDuckGo (keyless)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  if (!req.query.q) return res.status(400).json({ error: 'Manca q' });
  const q = (req.query.q + ' bottiglia').trim();

  const engines = [];
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) {
    engines.push(['google', () => googleImages(q)]);
  }
  engines.push(['bing', () => bingImages(q)]);
  engines.push(['duckduckgo', () => duckImages(q)]);

  let lastErr = null;
  for (const [name, fn] of engines) {
    try {
      const results = await fn();
      if (results.length) return res.status(200).json({ results, engine: name });
    } catch (e) {
      lastErr = e.message;
    }
  }
  return res.status(200).json({ results: [], engine: 'none', error: lastErr });
}

async function googleImages(q) {
  const key = process.env.GOOGLE_CSE_KEY,
    cx = process.env.GOOGLE_CSE_CX;
  const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&searchType=image&num=5&safe=active&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error('Google: ' + (d.error?.message || r.status));
  return (d.items || []).slice(0, 5).map((it) => ({
    full: it.link,
    thumb: it.image?.thumbnailLink || it.link,
    src: it.displayLink || '',
  }));
}

async function bingImages(q) {
  const r = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9' },
  });
  const html = await r.text();
  const out = [];
  const seen = new Set();
  // i metadati di ogni risultato stanno in m="{...&quot;murl&quot;:&quot;<url>&quot;,&quot;turl&quot;:&quot;<thumb>&quot;...}"
  const re = /murl&quot;:&quot;(.*?)&quot;[\s\S]*?turl&quot;:&quot;(.*?)&quot;/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    const full = decodeHtml(m[1]);
    const thumb = decodeHtml(m[2]) || full;
    if (/^https?:\/\//.test(full) && !seen.has(full)) {
      seen.add(full);
      out.push({ full, thumb, src: 'bing' });
    }
  }
  return out;
}

async function duckImages(q) {
  const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, {
    headers: { 'User-Agent': UA },
  });
  const html = await tokenRes.text();
  const m = html.match(/vqd=["']?([\w-]{6,})["']?/);
  if (!m) throw new Error('DDG: token non ottenuto');
  const r = await fetch(
    `https://duckduckgo.com/i.js?l=it-it&o=json&q=${encodeURIComponent(q)}&vqd=${m[1]}&f=,,,&p=1`,
    { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/', Accept: 'application/json' } }
  );
  const d = await r.json();
  return (d.results || []).slice(0, 6).map((it) => ({
    full: it.image,
    thumb: it.thumbnail || it.image,
    src: it.source || 'ddg',
  }));
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/\\u002f/gi, '/')
    .replace(/&quot;/g, '"');
}
