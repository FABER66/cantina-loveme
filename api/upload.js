export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, x-file-name');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_KEY = process.env.ADMIN_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  if (!SUPABASE_URL || !SECRET_KEY) {
    return res.status(500).json({ error: 'Variabili ambiente mancanti' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || 'image/jpeg';
    const originalName = req.headers['x-file-name'] || 'foto.jpg';
    const ext = originalName.split('.').pop().replace(/[^a-z0-9]/gi,'').toLowerCase() || 'jpg';
    const filePath = `${Date.now()}.${ext}`;

    // Upload su bucket "prodotti"
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/prodotti/${filePath}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'apikey': SECRET_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    });

    const responseText = await uploadRes.text();

    if (!uploadRes.ok) {
      return res.status(500).json({
        error: 'Upload fallito',
        status: uploadRes.status,
        detail: responseText
      });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/prodotti/${filePath}`;
    return res.status(200).json({ url: publicUrl });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
