export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_KEY = process.env.ADMIN_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Legge i metadati dal header
    const contentType = req.headers['content-type'] || 'image/jpeg';
    const fileName = req.headers['x-file-name'] || `foto_${Date.now()}.jpg`;
    const filePath = `prodotti/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${filePath}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SECRET_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(500).json({ error: 'Upload fallito', detail: err });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${filePath}`;
    return res.status(200).json({ url: publicUrl });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
