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
  const sec = params.sec;
  if (!sc || !sec) return res.status(400).json({ error: 'missing_params' });

  const filePath = `sc${sc}/${sec}.mp3`;
  try {
    // Create a short-lived signed URL and proxy the file to avoid CORS/public-bucket issues
    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 60);
    if (signErr || !signed || !signed.signedURL) {
      return res.status(404).json({ error: 'not_found' });
    }

    const r = await fetch(signed.signedURL);
    if (!r.ok) return res.status(r.status).json({ error: 'fetch_failed', status: r.status });
    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ct = r.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).end(buffer);
  } catch (e) {
    console.error('audio-get error', e);
    return res.status(500).json({ error: 'server_error', details: String(e) });
  }
}
