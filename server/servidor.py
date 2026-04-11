#!/usr/bin/env python3
"""
servidor.py — Servidor TTS para Gloomhaven
==========================================
Modos de operación (en orden de prioridad):

  1. AUDIO LOCAL   → Sirve MP3 pregenerado de audio/ si existe
  2. ELEVENLABS    → Genera en tiempo real via API (requiere ELEVEN_API_KEY + ELEVEN_VOICE_ID)
  3. EDGE TTS      → Fallback gratuito con Álvaro/Elvira Neural (Microsoft)

Instalación:
    pip install edge-tts requests

Arranque básico (solo Edge TTS):
    python servidor.py

Arranque con ElevenLabs (tiempo real):
    ELEVEN_API_KEY=xxx ELEVEN_VOICE_ID=yyy python servidor.py

Arranque con audio pregenerado (coste cero):
    python generar_audio.py --api-key xxx --voice-id yyy  # una sola vez
    python servidor.py                                     # sirve desde audio/
"""

import sys, asyncio, io, re, json, ssl, os, time, unicodedata, configparser
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

# ── Deshabilitar SSL (proxy corporativo) ──────────────────────────────────
os.environ["PYTHONHTTPSVERIFY"] = "0"
_orig_ssl_ctx = ssl.create_default_context
def _permissive_ssl(*args, **kwargs):
    ctx = _orig_ssl_ctx(*args, **kwargs)
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE
    return ctx
ssl.create_default_context = _permissive_ssl

import aiohttp as _aiohttp
_OrigConnector = _aiohttp.TCPConnector
class _NoVerifyConnector(_OrigConnector):
    def __init__(self, *args, **kwargs):
        kwargs['ssl'] = False
        super().__init__(*args, **kwargs)
_aiohttp.TCPConnector = _NoVerifyConnector

try:
    import edge_tts
except ImportError:
    print("\nERROR: Falta edge-tts.  Ejecuta:  pip install edge-tts\n")
    sys.exit(1)

try:
    import requests as _requests
    import urllib3 as _urllib3
    _urllib3.disable_warnings(_urllib3.exceptions.InsecureRequestWarning)
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# ══════════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN — modifica estos valores con tus credenciales de ElevenLabs
# ══════════════════════════════════════════════════════════════════════════

config = configparser.RawConfigParser()
config.read('../conf/Configuration.properties')

if config.has_section('ElevenLabs'):
    details_dict = dict(config.items('ElevenLabs'))
else:
    details_dict = {}
    print("ADVERTENCIA: sección 'ElevenLabs' no encontrada en conf/Configuration.properties. ELEVEN_API_KEY y ELEVEN_VOICE_ID quedan vacíos.")

PORT      = 7532
BASE_DIR  = Path(__file__).parent.resolve()
AUDIO_DIR = BASE_DIR.parent / "media/audio"   # directorio con MP3 pregenerados por generar_audio.py

# ── Configuración ElevenLabs ──────────────────────────────────────────────
ELEVEN_API_KEY  = details_dict.get('key', '')   # ← pega aquí tu API key de ElevenLabs
ELEVEN_VOICE_ID = details_dict.get('voice', '')   # ← Carmelo - Mysterious & Deep
ELEVEN_MODEL    = "eleven_turbo_v2_5"
ELEVEN_SETTINGS = {
    "stability":         0.55,
    "similarity_boost":  0.80,
    "style":             0.35,
    "use_speaker_boost": True,
}

# ── Voces Edge TTS (fallback) ─────────────────────────────────────────────
EDGE_VOICES = {
    "alvaro": {
        "name":  "es-ES-AlvaroNeural",
        "label": "Álvaro (Edge TTS · fallback)",
        "rate":  "-10%",
        "pitch": "-10Hz",
    },
    "elvira": {
        "name":  "es-ES-ElviraNeural",
        "label": "Elvira (Edge TTS · fallback)",
        "rate":  "-10%",
        "pitch": "+0Hz",
    },
}
DEFAULT_EDGE_VOICE = "alvaro"

# ── Utilidades ────────────────────────────────────────────────────────────

def slugify(text):
    text = unicodedata.normalize('NFD', text.lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')

_SKIP_MARKERS = re.compile(
    r'\[pausa\s*\w*\]|\[Reglas\s+Especiales\]|\[pausa\]',
    re.IGNORECASE
)
def clean_for_tts(text):
    text = _SKIP_MARKERS.sub("", text)
    text = re.sub(r'\n{2,}', '\n', text)
    text = re.sub(r'\n', ' ', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()

def enrich_edge(text):
    """Pre-procesado narrativo específico para Edge TTS."""
    text = re.sub(r'(?<![,;:])\\s+(pero|aunque|sin embargo|no obstante)',
                  r', \\1', text, flags=re.IGNORECASE)
    text = re.sub(r'\\n{2,}', '. ', text)
    text = re.sub(r'\\n', ' ', text)
    return text.strip()

# ── Modos de síntesis ─────────────────────────────────────────────────────

def serve_local(sc_num, sec_slug):
    """Intenta servir un MP3 pregenerado. Devuelve bytes o None."""
    if not AUDIO_DIR.exists():
        return None
    path = AUDIO_DIR / f"sc{sc_num}" / f"{sec_slug}.mp3"
    print(f"  [serve_local] buscando: {path} -> {'ENCONTRADO' if path.exists() else 'NO EXISTE'}")
    if path.exists():
        return path.read_bytes()
    # Listar qué hay en el directorio para depuración
    sc_path = AUDIO_DIR / f"sc{sc_num}"
    if sc_path.exists():
        files = [f.name for f in sc_path.iterdir()]
        print(f"  [serve_local] archivos en sc{sc_num}/: {files}")
    return None

def synthesize_elevenlabs(text, api_key=None, voice_id=None):
    """Llama a ElevenLabs y devuelve bytes MP3 o None.
    Si se pasan `api_key` y `voice_id`, se usan esos valores en lugar
    de las variables globales de configuración.
    """
    key = api_key or ELEVEN_API_KEY
    vid = voice_id or ELEVEN_VOICE_ID
    if not HAS_REQUESTS or not key or not vid:
        return None
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}"
    headers = {
        "xi-api-key":   key,
        "Content-Type": "application/json",
        "Accept":       "audio/mpeg",
    }
    payload = {
        "text":           clean_for_tts(text),
        "model_id":       ELEVEN_MODEL,
        "voice_settings": ELEVEN_SETTINGS,
    }
    try:
        resp = _requests.post(url, headers=headers, json=payload, timeout=60, verify=False)
        if resp.status_code == 429:
            print("  [ElevenLabs] Rate limit — esperando 60s...")
            time.sleep(60)
            return synthesize_elevenlabs(text, api_key=key, voice_id=vid)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  [ElevenLabs] ERROR: {e}")
        return None

async def synthesize_edge_async(text, voice_key="alvaro", speed_factor=1.0):
    """Síntesis con Edge TTS (fallback gratuito)."""
    cfg  = EDGE_VOICES.get(voice_key, EDGE_VOICES[DEFAULT_EDGE_VOICE])
    base = int(cfg["rate"].rstrip("%").replace("+", ""))
    adj  = int((speed_factor - 1.0) * 100)
    rate_str = f"{base + adj:+d}%"
    text = enrich_edge(clean_for_tts(text))
    communicate = edge_tts.Communicate(text, cfg["name"],
                                       rate=rate_str, pitch=cfg["pitch"])
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()

def synthesize_edge(text, voice_key="alvaro", speed_factor=1.0):
    return asyncio.run(synthesize_edge_async(text, voice_key, speed_factor))

# ── Servidor HTTP ─────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def cors(self):
        pass  # ya no hace falta llamarlo explícitamente, end_headers lo hace siempre

    def end_headers(self):
        """Siempre añade CORS antes de cerrar los headers."""
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200); self.cors(); self.end_headers()

    def do_GET(self):
        p  = urlparse(self.path)
        qs = parse_qs(p.query)

        # ── SERVIR ARCHIVOS ESTÁTICOS ─────────────────────────────────────
        # Permite servir cualquier archivo desde la raíz del proyecto
        static_root = BASE_DIR.parent
        static_path = (static_root / p.path.lstrip("/")).resolve()
        # Seguridad: no permitir salir de la raíz
        if static_path.is_file() and str(static_path).startswith(str(static_root)):
            # Determinar el tipo de contenido
            if static_path.suffix in ['.html', '.htm']:
                ctype = 'text/html; charset=utf-8'
            elif static_path.suffix == '.css':
                ctype = 'text/css; charset=utf-8'
            elif static_path.suffix == '.js':
                ctype = 'application/javascript; charset=utf-8'
            elif static_path.suffix == '.json':
                ctype = 'application/json; charset=utf-8'
            elif static_path.suffix in ['.ttf', '.otf']:
                ctype = 'font/ttf'
            elif static_path.suffix == '.svg':
                ctype = 'image/svg+xml'
            elif static_path.suffix in ['.jpg', '.jpeg']:
                ctype = 'image/jpeg'
            elif static_path.suffix == '.png':
                ctype = 'image/png'
            elif static_path.suffix == '.mp3':
                ctype = 'audio/mpeg'
            else:
                ctype = 'application/octet-stream'
            try:
                with open(static_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(content)))
                self.cors(); self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500); self.end_headers()
                self.wfile.write(f"Error leyendo archivo: {e}".encode())
            return

        # ── GET /voices ───────────────────────────────────────────────────
        if p.path == "/voices":
            voices = []
            if ELEVEN_API_KEY and ELEVEN_VOICE_ID:
                voices.append({
                    "id":    "elevenlabs",
                    "label": "ElevenLabs (voz épica)"
                })
            for k, v in EDGE_VOICES.items():
                voices.append({"id": k, "label": v["label"]})

            body = json.dumps(voices).encode()
            self.send_response(200)
            self.send_header("Content-Type",   "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.cors(); self.end_headers()
            self.wfile.write(body)
            return

        # ── GET /tts ──────────────────────────────────────────────────────
        if p.path == "/tts":
            text      = unquote(qs.get("text",  [""])[0]).strip()
            voice_key = qs.get("voice", ["elevenlabs" if ELEVEN_VOICE_ID else DEFAULT_EDGE_VOICE])[0]
            sc_num    = qs.get("sc",    [""])[0].strip()
            sec_slug  = qs.get("sec",   [""])[0].strip()
            try:
                speed = float(qs.get("speed", ["1.0"])[0])
                speed = max(0.5, min(speed, 1.5))
            except ValueError:
                speed = 1.0

            if not text:
                self.send_response(400); self.end_headers(); return

            mp3 = None
            source = ""

            # Prioridad 1: audio local pregenerado
            if sc_num and sec_slug:
                mp3 = serve_local(sc_num, sec_slug)
                if mp3:
                    source = f"LOCAL sc{sc_num}/{sec_slug}.mp3"

            # Prioridad 2: Edge TTS (si no hay audio local)
            if mp3 is None:
                edge_key = voice_key if voice_key in EDGE_VOICES else DEFAULT_EDGE_VOICE
                print(f"  [Edge TTS/{edge_key}] {len(text)} chars...", end="", flush=True)
                try:
                    mp3 = synthesize_edge(text, edge_key, speed)
                    source = f"Edge TTS ({edge_key})"
                except Exception as e:
                    print(f" ERROR: {e}")
                    self.send_response(500); self.end_headers(); return

            print(f" OK → {len(mp3)//1024} KB  [{source}]")
            self.send_response(200)
            self.send_header("Content-Type",   "audio/mpeg")
            self.send_header("Content-Length", str(len(mp3)))
            self.cors(); self.end_headers()
            self.wfile.write(mp3)
            return

        # ── GET /audio-check ─────────────────────────────────────────────
        if p.path == "/audio-check":
            sc_num   = qs.get("sc",  [""])[0].strip()
            sec_slug = qs.get("sec", [""])[0].strip()
            if sc_num and sec_slug:
                mp3_path = AUDIO_DIR / f"sc{sc_num}" / f"{sec_slug}.mp3"
                if mp3_path.exists():
                    self.send_response(200); self.cors(); self.end_headers()
                    return
            self.send_response(404); self.cors(); self.end_headers()
            return

        # ── GET /download ─────────────────────────────────────────────────
        # Genera y guarda el MP3 de una sección via ElevenLabs
        if p.path == "/download":
            sc_num      = qs.get("sc",  [""])[0].strip()
            sec_slug    = qs.get("sec", [""])[0].strip()
            api_key_q   = qs.get("api_key", [""])[0].strip()
            voice_id_q  = qs.get("voice_id", [""])[0].strip()
            if not sc_num or not sec_slug:
                self.send_response(400); self.end_headers(); return

            mp3_path = AUDIO_DIR / f"sc{sc_num}" / f"{sec_slug}.mp3"

            # Si ya existe, no gastar créditos
            if mp3_path.exists():
                self.send_response(200); self.cors(); self.end_headers()
                return

            # Determinar qué credenciales usar (parámetros de la petición > configuración)
            api_key_to_use = api_key_q if api_key_q else ELEVEN_API_KEY
            voice_id_to_use = voice_id_q if voice_id_q else ELEVEN_VOICE_ID

            # Verificar que hay credenciales disponibles
            if not api_key_to_use or not voice_id_to_use:
                body = json.dumps({"error": "no_config", "message": "ElevenLabs no configurado. Proporciona api_key y voice_id en la petición."}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return

            # Obtener el texto de la sección desde el JSON de escenarios
            data_path = BASE_DIR.parent / "media/gloomhaven_data.json"
            if not data_path.exists():
                self.send_response(503); self.end_headers(); return
            with open(data_path, encoding="utf-8") as f_data:
                sc_data = json.load(f_data)

            sc = sc_data.get(sc_num)
            if not sc:
                self.send_response(404); self.end_headers(); return

            # Buscar la sección por slug
            import unicodedata as _ud
            def _slugify(t):
                t = _ud.normalize('NFD', t.lower())
                t = ''.join(c for c in t if _ud.category(c) != 'Mn')
                t = re.sub(r'[^a-z0-9]+', '_', t)
                return t.strip('_')

            sec_text = None
            for s in sc.get("secciones", []):
                if _slugify(s["titulo"]) == sec_slug:
                    sec_text = s["texto"]
                    break

            if sec_text is None:
                self.send_response(404); self.end_headers(); return

            # Comprobar créditos disponibles antes de sintetizar (usar api_key_to_use)
            try:
                import requests as _req
                sub_resp = _req.get(
                    "https://api.elevenlabs.io/v1/user/subscription",
                    headers={"xi-api-key": api_key_to_use},
                    timeout=10, verify=False
                )
                if sub_resp.ok:
                    sub = sub_resp.json()
                    used      = sub.get("character_count", 0)
                    limit     = sub.get("character_limit", 10000)
                    remaining = limit - used
                    chars     = len(clean_for_tts(sec_text))
                    if chars > remaining:
                        body = json.dumps({
                            "error":   "cost_warning",
                            "message": f"Créditos insuficientes: necesitas {chars:,} pero solo quedan {remaining:,} de {limit:,}."
                        }).encode()
                        self.send_response(402)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(body)
                        return
            except Exception as e:
                print(f"  [/download] No se pudo verificar créditos: {e}")

            # Sintetizar con ElevenLabs y guardar
            print(f"  [/download] ElevenLabs SC#{sc_num} '{sec_slug}'...", end="", flush=True)
            mp3 = synthesize_elevenlabs(sec_text, api_key=api_key_to_use, voice_id=voice_id_to_use)
            if mp3:
                mp3_path.parent.mkdir(parents=True, exist_ok=True)
                mp3_path.write_bytes(mp3)
                print(f" OK ({len(mp3)//1024} KB)")
                # Actualizar manifest.json
                sc_nombre = sc.get("nombre", f"Escenario {sc_num}")
                update_manifest(sc_num, sc_nombre, sec_slug, mp3_path)
                self.send_response(200); self.end_headers()
            else:
                print(" ERROR")
                self.send_response(500); self.end_headers()
            return

        self.send_response(404); self.end_headers()

    def do_POST(self):
        p = urlparse(self.path)
        # Soportar POST /download con JSON: { sc, sec, api_key, voice_id }
        if p.path == "/download":
            # Leer body JSON
            try:
                length = int(self.headers.get('Content-Length', 0))
            except Exception:
                length = 0
            try:
                body_bytes = self.rfile.read(length) if length else b''
                data = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
            except Exception:
                self.send_response(400); self.end_headers(); return

            sc_num      = str(data.get('sc', '')).strip()
            sec_slug    = str(data.get('sec', '')).strip()
            api_key_q   = str(data.get('api_key', '')).strip()
            voice_id_q  = str(data.get('voice_id', '')).strip()
            if not sc_num or not sec_slug:
                self.send_response(400); self.end_headers(); return

            mp3_path = AUDIO_DIR / f"sc{sc_num}" / f"{sec_slug}.mp3"

            # Si ya existe, no gastar créditos
            if mp3_path.exists():
                self.send_response(200); self.cors(); self.end_headers()
                return

            # Determinar qué credenciales usar (body > configuración)
            api_key_to_use = api_key_q if api_key_q else ELEVEN_API_KEY
            voice_id_to_use = voice_id_q if voice_id_q else ELEVEN_VOICE_ID

            # Verificar que hay credenciales disponibles
            if not api_key_to_use or not voice_id_to_use:
                body = json.dumps({"error": "no_config", "message": "ElevenLabs no configurado. Proporciona api_key y voice_id en la petición."}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return

            # Obtener el texto de la sección desde el JSON de escenarios
            data_path = BASE_DIR.parent / "media/gloomhaven_data.json"
            if not data_path.exists():
                self.send_response(503); self.end_headers(); return
            with open(data_path, encoding="utf-8") as f_data:
                sc_data = json.load(f_data)

            sc = sc_data.get(sc_num)
            if not sc:
                self.send_response(404); self.end_headers(); return

            # Buscar la sección por slug
            import unicodedata as _ud
            def _slugify(t):
                t = _ud.normalize('NFD', t.lower())
                t = ''.join(c for c in t if _ud.category(c) != 'Mn')
                t = re.sub(r'[^a-z0-9]+', '_', t)
                return t.strip('_')

            sec_text = None
            for s in sc.get("secciones", []):
                if _slugify(s["titulo"]) == sec_slug:
                    sec_text = s["texto"]
                    break

            if sec_text is None:
                self.send_response(404); self.end_headers(); return

            # Comprobar créditos disponibles antes de sintetizar (usar api_key_to_use)
            try:
                import requests as _req
                sub_resp = _req.get(
                    "https://api.elevenlabs.io/v1/user/subscription",
                    headers={"xi-api-key": api_key_to_use},
                    timeout=10, verify=False
                )
                if sub_resp.ok:
                    sub = sub_resp.json()
                    used      = sub.get("character_count", 0)
                    limit     = sub.get("character_limit", 10000)
                    remaining = limit - used
                    chars     = len(clean_for_tts(sec_text))
                    if chars > remaining:
                        body = json.dumps({
                            "error":   "cost_warning",
                            "message": f"Créditos insuficientes: necesitas {chars:,} pero solo quedan {remaining:,} de {limit:,}."
                        }).encode()
                        self.send_response(402)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(body)
                        return
            except Exception as e:
                print(f"  [/download POST] No se pudo verificar créditos: {e}")

            # Sintetizar con ElevenLabs y guardar
            print(f"  [/download POST] ElevenLabs SC#{sc_num} '{sec_slug}'...", end="", flush=True)
            mp3 = synthesize_elevenlabs(sec_text, api_key=api_key_to_use, voice_id=voice_id_to_use)
            if mp3:
                mp3_path.parent.mkdir(parents=True, exist_ok=True)
                mp3_path.write_bytes(mp3)
                print(f" OK ({len(mp3)//1024} KB)")
                # Actualizar manifest.json
                sc_nombre = sc.get("nombre", f"Escenario {sc_num}")
                update_manifest(sc_num, sc_nombre, sec_slug, mp3_path)
                self.send_response(200); self.end_headers()
            else:
                print(" ERROR")
                self.send_response(500); self.end_headers()
            return

        self.send_response(404); self.end_headers()

# ── Manifest ──────────────────────────────────────────────────────────────

def update_manifest(sc_num, sc_nombre, sec_slug, mp3_path):
    """Actualiza audio/manifest.json añadiendo la entrada del MP3 recién generado."""
    manifest_path = AUDIO_DIR / "manifest.json"
    try:
        # Leer manifest existente o crear uno vacío
        if manifest_path.exists():
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
        else:
            manifest = {}

        # Asegurar que existe la entrada del escenario
        if sc_num not in manifest:
            manifest[sc_num] = {"nombre": sc_nombre, "secciones": {}}
        elif "secciones" not in manifest[sc_num]:
            manifest[sc_num]["secciones"] = {}

        # Añadir la ruta relativa al manifest (igual que generar_audio.py)
        rel_path = mp3_path.relative_to(AUDIO_DIR)
        manifest[sc_num]["secciones"][sec_slug] = str(rel_path)

        # Guardar
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        print(f"  [manifest] SC#{sc_num} '{sec_slug}' → {rel_path}")
    except Exception as e:
        print(f"  [manifest] Error al actualizar: {e}")

# ── Arranque ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Detectar modo activo
    has_local    = AUDIO_DIR.exists() and any(AUDIO_DIR.glob("sc*/*.mp3"))
    has_eleven   = bool(ELEVEN_API_KEY and ELEVEN_VOICE_ID)
    local_count  = sum(1 for _ in AUDIO_DIR.glob("sc*/*.mp3")) if has_local else 0

    mode_lines = []
    if has_local:
        mode_lines.append(f"  [OK] Audio local  : {local_count} archivos en {AUDIO_DIR}/")
    else:
        mode_lines.append(f"  [--] Audio local  : no encontrado (ejecuta generar_audio.py)")
    if has_eleven:
        mode_lines.append(f"  [OK] ElevenLabs   : voice_id={ELEVEN_VOICE_ID[:12]}...")
    else:
        mode_lines.append(f"  [--] ElevenLabs   : no configurado (ELEVEN_API_KEY / ELEVEN_VOICE_ID)")
    mode_lines.append(f"  [OK] Edge TTS     : fallback activo (Alvaro / Elvira Neural)")

    print("-" * 52)
    print(f"       Gloomhaven TTS - servidor.py")
    print(f"       http://localhost:{PORT}")
    print("-" * 52)
    print(" Modos activos:")
    print("\n".join(f" - {l}" for l in mode_lines))
    print("-" * 52)
    print("  Ctrl+C para detener.\n")

    import webbrowser
    import threading
    import time

    # Abrir gloomhaven.html una sola vez
    html_path = BASE_DIR.parent / "gloomhaven.html"
    if html_path.exists():
        print(f"Abriendo gloomhaven.html en http://localhost:{PORT}/gloomhaven.html ...")
        webbrowser.open(f"http://localhost:{PORT}/gloomhaven.html")
    else:
        print(f"ADVERTENCIA: gloomhaven.html no encontrado en {html_path}")

    server = HTTPServer(("localhost", PORT), Handler)

    def run_server():
        try:
            server.serve_forever()
        except Exception as e:
            print(f"\nServidor detenido: {e}")

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    try:
        while server_thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
        server.shutdown()
        # Realizar petición dummy para desbloquear el servidor
        try:
            import socket
            with socket.create_connection(("localhost", PORT), timeout=2) as sock:
                pass
        except Exception:
            pass
        server_thread.join()
        print("Servidor detenido.")
