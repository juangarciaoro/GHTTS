import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_CREATE_SECRET = process.env.ADMIN_CREATE_SECRET || null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase env vars not set: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method' });

  // Optional admin secret protection
  if (ADMIN_CREATE_SECRET) {
    const provided = (req.headers['x-admin-secret'] || req.headers['x-admin-secret'.toLowerCase()]) || null;
    if (!provided || provided !== ADMIN_CREATE_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  let email = '';
  if (req.method === 'GET') {
    email = (req.query && req.query.email) ? String(req.query.email).trim() : '';
  } else {
    let body = req.body || {};
    if (!body || Object.keys(body).length === 0) {
      try {
        const raw = await new Promise(r => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>r(d)); });
        body = JSON.parse(raw || '{}');
      } catch(e) { body = body || {}; }
    }
    email = String(body.email || '').trim();
  }

  if (!email) return res.status(400).json({ error: 'invalid_input', message: 'email required' });

  try {
    // Try using admin listUsers if available on the client
    try {
      if (supabase && supabase.auth && supabase.auth.admin && typeof supabase.auth.admin.listUsers === 'function') {
        // Some supabase-js versions expose an admin.listUsers; try it
        try {
          const { data, error } = await supabase.auth.admin.listUsers({ filter: `email.eq.${email}` });
          if (!error && data && Array.isArray(data.users)) {
            return res.status(200).json({ exists: data.users.length > 0, users: data.users });
          }
        } catch(e) {
          // fall through to REST
        }
      }
    } catch(e) {}

    // REST fallback: query admin users endpoint
    const adminUrl = SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/admin/users?email=' + encodeURIComponent(email);
    const r = await fetch(adminUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY
      }
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
    if (!r.ok) {
      return res.status(r.status || 502).json({ error: 'supabase_admin_error', status: r.status, body: parsed });
    }

    let exists = false;
    if (Array.isArray(parsed)) exists = parsed.length > 0;
    else if (parsed && (parsed.id || parsed.user_id || parsed.length)) exists = true;

    return res.status(200).json({ exists, body: parsed });
  } catch (e) {
    console.error('check-user error', e);
    return res.status(500).json({ error: 'server', message: e.message || String(e) });
  }
}
