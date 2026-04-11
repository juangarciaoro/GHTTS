const EDGE_VOICES = [
  { id: 'alvaro', label: 'Álvaro (Edge TTS · fallback)' },
  { id: 'elvira', label: 'Elvira (Edge TTS · fallback)' },
];

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const voices = [];
  if (process.env.ELEVEN_API_KEY && process.env.ELEVEN_VOICE_ID) {
    voices.push({ id: 'elevenlabs', label: 'ElevenLabs (voz épica)' });
  }
  voices.push(...EDGE_VOICES);
  return res.status(200).json(voices);
}
