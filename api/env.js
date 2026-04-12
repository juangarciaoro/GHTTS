import fs from 'fs';
import path from 'path';

function parseDotEnv(content) {
  const out = {};
  const lines = String(content || '').split(/\r?\n/);
  for (let l of lines) {
    l = l.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq === -1) continue;
    const key = l.slice(0, eq).trim();
    let val = l.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let SUPABASE_URL = process.env.SUPABASE_URL || null;
  let SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;

  // If not present in process.env (vercel dev may ignore .env.local), try to read .env.local directly
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const parsed = parseDotEnv(content);
        SUPABASE_URL = SUPABASE_URL || parsed.SUPABASE_URL || parsed.SUPABASE_URL?.trim() || null;
        SUPABASE_ANON_KEY = SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY?.trim() || null;
      }
    } catch (e) {
      // ignore
    }
  }

  // Only return public values (do NOT expose service role keys here)
  return res.status(200).json({ SUPABASE_URL: SUPABASE_URL || null, SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || null });
}
