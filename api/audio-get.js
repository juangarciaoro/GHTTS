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
    let fetchUrl = null;
    if (signed && signed.signedURL) {
      fetchUrl = signed.signedURL;
    } else {
      console.warn('createSignedUrl failed or returned no URL', signErr);
      // Fallback: try public bucket path if SUPABASE_URL is available
      if (SUPABASE_URL) {
        const base = SUPABASE_URL.replace(/\/$/, '');
        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        fetchUrl = `${base}/storage/v1/object/public/${BUCKET}/${encodedPath}`;
        console.info('Falling back to public URL', fetchUrl);
      } else {
        return res.status(404).json({ error: 'not_found', details: signErr ? (signErr.message || String(signErr)) : 'no_signed_url' });
      }
    }

    const r = await fetch(fetchUrl);
    if (!r.ok) {
      const bodyText = await r.text().catch(() => '');
      console.error('fetch failed', fetchUrl, r.status, bodyText.slice(0, 200));
      return res.status(r.status).json({ error: 'fetch_failed', status: r.status, details: bodyText.slice(0, 1000) });
    }
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
