// Cron giornaliero: tiene "sveglio" il progetto Supabase (piano free)
// evitando la pausa automatica dopo ~7 giorni di inattività.
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !ANON_KEY) {
    return res.status(500).json({ error: 'Variabili ambiente mancanti' });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/locali?select=id&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    });
    return res.status(200).json({ ok: r.ok, status: r.status, ts: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
