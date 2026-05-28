// Scarica un'immagine da un URL e la salva sul bucket Supabase "prodotti".
// Serve per "pubblicare" lato server la foto scelta (evita problemi CORS lato client).
// Body JSON: { url:<image url> }  ->  { url:<public supabase url> }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_KEY = process.env.ADMIN_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorizzato' });
  if (!SUPABASE_URL || !SECRET_KEY) return res.status(500).json({ error: 'Variabili ambiente mancanti' });

  const srcUrl = (req.body && req.body.url) || '';
  if (!/^https?:\/\//i.test(srcUrl)) return res.status(400).json({ error: 'URL non valido' });

  try {
    const imgRes = await fetch(srcUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!imgRes.ok) return res.status(502).json({ error: 'Download immagine fallito (' + imgRes.status + ')' });

    let contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/')) contentType = 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Immagine troppo grande' });

    const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'jpg';
    const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/prodotti/${filePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        apikey: SECRET_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (!uploadRes.ok) {
      return res.status(500).json({ error: 'Upload fallito', detail: await uploadRes.text() });
    }
    return res.status(200).json({ url: `${SUPABASE_URL}/storage/v1/object/public/prodotti/${filePath}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
