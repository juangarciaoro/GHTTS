import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'audio';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase env vars not set: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function slugify(text){
  return String(text||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}

function cleanForTTS(text){
  return String(text||'')
    .replace(/\[pausa\s*\w*\]|\[Reglas\s+Especiales\]|\[Especial Jefe( \d+)?\]/gi,'')
    .replace(/\n{2,}/g,'\n')
    .replace(/\n/g,' ').replace(/  +/g,' ').trim();
}

function getUserIdFromAccessToken(token){
  try{
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return obj.sub || obj.user_id || null;
  }catch(e){ return null; }
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    const body = req.body || await new Promise(r=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>r(JSON.parse(d||'{}'))); });
    const sc = body.sc;
    const sec = body.sec;
    let api_key = body.api_key || null;
    let voice_id = body.voice_id || null;

    // If no api_key provided, try fetch from user_credentials using Authorization bearer token
    if ((!api_key || !voice_id) && req.headers && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      const token = parts.length>1 ? parts[1] : parts[0];
      const userId = getUserIdFromAccessToken(token);
      if (userId) {
        const { data, error } = await supabase.from('user_credentials').select('eleven_api_key, eleven_voice_id').eq('user_id', userId).single();
        if (!error && data) {
          api_key = api_key || data.eleven_api_key || null;
          voice_id = voice_id || data.eleven_voice_id || null;
        }
      }
    }

    if (!api_key || !voice_id) {
      return res.status(400).json({ error: 'no_credentials', message: 'API key or voice id required' });
    }

    // Load data file from assets
    const dataPath = path.join(process.cwd(), 'assets', 'gloomhaven_data.json');
    const file = await fs.readFile(dataPath, 'utf8');
    const DATA = JSON.parse(file);
    const item = DATA[sc];
    if (!item) return res.status(404).json({ error: 'no_scenario' });
    const section = item.secciones.find(s=>slugify(s.titulo) === sec);
    if (!section) return res.status(404).json({ error: 'no_section' });

    const text = cleanForTTS(section.texto || section.titulo || '');
    const filename = `${slugify(item.nombre || ('sc'+sc))}/${sec}.mp3`;

    // Check if file already exists in storage
    try{
      const { data: existing, error: e1 } = await supabase.storage.from(BUCKET).download(filename);
      if (!e1 && existing) {
        return res.status(200).json({ ok: true, uploaded: false, path: filename });
      }
    }catch(e){ /* not found - proceed */ }

    // Call ElevenLabs TTS
    const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream`;
    const elevenResp = await fetch(elevenUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!elevenResp.ok) {
      const errText = await elevenResp.text().catch(()=>null);
      return res.status(502).json({ error: 'eleven_error', status: elevenResp.status, body: errText });
    }

    const arrayBuffer = await elevenResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase storage
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(filename, buffer, { contentType: 'audio/mpeg', upsert: true });
    if (upErr) {
      return res.status(500).json({ error: 'upload_error', message: upErr.message || String(upErr) });
    }

    return res.status(200).json({ ok: true, uploaded: true, path: filename });

  } catch (e) {
    console.error('download_v2 error', e);
    return res.status(500).json({ error: 'server', message: e.message });
  }
}
