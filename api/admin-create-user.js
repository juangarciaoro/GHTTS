import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase env vars not set: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Optional admin secret to protect this endpoint. If set, callers must provide
// header 'x-admin-secret' with the matching value.
const ADMIN_CREATE_SECRET = process.env.ADMIN_CREATE_SECRET || null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    // require admin secret if configured
    if (ADMIN_CREATE_SECRET) {
      const provided = (req.headers['x-admin-secret'] || req.headers['x-admin-secret'.toLowerCase()]) || null;
      if (!provided || provided !== ADMIN_CREATE_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    let body;
    try { body = req.body; } catch (err) {
      const raw = await new Promise(r=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>r(d)); });
      try { body = JSON.parse(raw || '{}'); } catch(e2) { throw new Error('Invalid JSON'); }
    }
    body = body || {};
    const email = (body.email || '').trim();
    const password = String(body.password || '');
    const display_name = body.display_name || body.name || null;

    if (!email || !password) return res.status(400).json({ error: 'invalid_input', message: 'email and password required' });

    // Try using supabase-js admin API if available
    try {
      if (supabase && supabase.auth && supabase.auth.admin && typeof supabase.auth.admin.createUser === 'function') {
        const opts = { email, password, user_metadata: display_name ? { display_name } : undefined, email_confirm: true };
        const { data, error } = await supabase.auth.admin.createUser(opts);
        if (error) return res.status(400).json({ error: 'create_user_failed', message: error.message || String(error) });
        return res.status(200).json({ ok: true, user: data });
      }
    } catch (e) {
      // fall through to REST fallback
      console.warn('admin.createUser failed, falling back to REST', e?.message || e);
    }

    // REST fallback to /auth/v1/admin/users
    const adminUrl = SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/users';
    const payload = { email, password, user_metadata: display_name ? { display_name } : undefined, email_confirm: true, email_confirmed_at: new Date().toISOString() };
    const resp = await fetch(adminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
    if (!resp.ok) {
      return res.status(resp.status || 502).json({ error: 'supabase_admin_error', status: resp.status, body: parsed });
    }
    return res.status(200).json({ ok: true, user: parsed });

  } catch (e) {
    console.error('admin-create-user error', e);
    return res.status(500).json({ error: 'server', message: e.message || String(e) });
  }
}
