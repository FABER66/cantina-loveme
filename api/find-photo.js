// Cerca foto di una bottiglia sul web e restituisce qualche candidato da confermare.
// GET ?q=<nome vino>  ->  { results:[ {thumb, full, src} ], engine }
// Usa Google Custom Search se sono presenti GOOGLE_CSE_KEY + GOOGLE_CSE_CX,
// altrimenti ripiega su DuckDuckGo (keyless).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  const q = ((req.query.q || '') + ' bottiglia vino').trim();
  if (!req.query.q) return res.status(400).json({ error: 'Manca q' });

  const CSE_KEY = process.env.GOOGLE_CSE_KEY;
  const CSE_CX = process.env.GOOGLE_CSE_CX;

  try {
    if (CSE_KEY && CSE_CX) {
      const results = await googleImages(q, CSE_KEY, CSE_CX);
      if (results.length) return res.status(200).json({ results, engine: 'google' });
    }
    const results = await duckImages(q);
    return res.status(200).json({ results, engine: 'duckduckgo' });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [] });
  }
}

async function googleImages(q, key, cx) {
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

async function duckImages(q) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  // 1) ottieni il token vqd
  const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, {
    headers: { 'User-Agent': UA },
  });
  const html = await tokenRes.text();
  const m = html.match(/vqd=["']?([\d-]+)["']?/);
  if (!m) throw new Error('Token ricerca non ottenuto');
  const vqd = m[1];
  // 2) richiedi i risultati immagini
  const r = await fetch(
    `https://duckduckgo.com/i.js?l=it-it&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,&p=1`,
    { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/', 'Accept': 'application/json' } }
  );
  const d = await r.json();
  return (d.results || []).slice(0, 6).map((it) => ({
    full: it.image,
    thumb: it.thumbnail || it.image,
    src: it.source || '',
  }));
}
