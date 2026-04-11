import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'audio';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const params = req.method === 'GET' ? req.query : (req.body || {});
  const sc = params.sc;
  const sec = params.sec;
  if (!sc || !sec) return res.status(400).json({ error: 'missing_params' });

  const filePath = `sc${sc}/${sec}.mp3`;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(filePath);
    if (data && !error) return res.status(200).end();
    return res.status(404).end();
  } catch (e) {
    return res.status(500).json({ error: 'check_failed', details: String(e) });
  }
}
