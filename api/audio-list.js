import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'audio';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const params = req.method === 'GET' ? req.query : (req.body || {});
  const sc = params.sc;
  if (!sc) return res.status(400).json({ error: 'missing_params' });

  try {
    const folder = `sc${sc}`;
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error) {
      console.error('storage.list error', error);
      return res.status(500).json({ error: 'list_failed', details: error.message || String(error) });
    }
    return res.status(200).json({ files: data || [] });
  } catch (e) {
    console.error('audio-list error', e);
    return res.status(500).json({ error: 'server_error', details: String(e) });
  }
}
