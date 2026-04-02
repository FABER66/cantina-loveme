export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const ADMIN_KEY = process.env.ADMIN_KEY;

  const isAdmin = req.headers['x-admin-key'] === ADMIN_KEY;
  const authKey = isAdmin ? SECRET_KEY : ANON_KEY;

  const { table, id, on_conflict } = req.query;
  if (!table) return res.status(400).json({ error: 'Missing table' });

  // build Supabase URL
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = new URLSearchParams();
  if (id) params.append('id', `eq.${id}`);
  if (on_conflict) params.append('on_conflict', on_conflict);

  // extra query params forwarded
  const skip = ['table','id','on_conflict'];
  for (const [k,v] of Object.entries(req.query)) {
    if (!skip.includes(k)) params.append(k, v);
  }
  if ([...params].length) url += '?' + params.toString();

  const headers = {
    'apikey': authKey,
    'Authorization': 'Bearer ' + authKey,
    'Content-Type': 'application/json',
  };
  if (['POST','PATCH'].includes(req.method)) {
    headers['Prefer'] = req.method === 'POST' ? 'return=representation' : 'return=representation';
    if (on_conflict) headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
  }

  const fetchOpts = { method: req.method, headers };
  if (req.body && Object.keys(req.body).length) {
    fetchOpts.body = JSON.stringify(req.body);
  }

  const sbRes = await fetch(url, fetchOpts);
  const text = await sbRes.text();
  res.status(sbRes.status);
  try { res.json(JSON.parse(text)); } catch { res.send(text); }
}
