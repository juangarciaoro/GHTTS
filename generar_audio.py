#!/usr/bin/env python3
"""
generar_audio.py — Pre-generación masiva de audio para Gloomhaven
==================================================================
Descarga todas las secciones de todos los escenarios desde ElevenLabs
y las organiza en audio/sc{N}/{slug}.mp3

Uso:
    pip install requests
    python generar_audio.py --api-key TU_API_KEY --voice-id TU_VOICE_ID

Opciones:
    --api-key   API key de ElevenLabs (o variable de entorno ELEVEN_API_KEY)
    --voice-id  ID de la voz elegida en ElevenLabs
    --data      Ruta al JSON de escenarios (default: gloomhaven_data.json)
    --out       Directorio de salida (default: audio/)
    --sc-list   Escenarios concretos a generar, separados por comas (ej: 43 o 1,5,12)
    --from-sc   Empezar desde el escenario N (para resumir si se interrumpe)
    --dry-run   Muestra qué se generaría sin hacer peticiones
    --delay     Segundos entre peticiones (default: 0.5, respetar rate limit)

Ejemplos:
    # Solo el escenario 43
    python generar_audio.py --api-key KEY --voice-id VID --sc-list 43

    # Escenarios concretos de una sesión
    python generar_audio.py --api-key KEY --voice-id VID --sc-list 1,2,3

    # Todo desde el escenario 10 en adelante
    python generar_audio.py --api-key KEY --voice-id VID --from-sc 10

    # Simular sin gastar créditos
    python generar_audio.py --api-key KEY --voice-id VID --sc-list 43 --dry-run

Estructura de salida:
    audio/
      sc1/
        introduccion.mp3
        introduccion_2.mp3
        conclusion.mp3
      sc2/
        ...
      manifest.json   ← índice de todos los archivos generados
"""

import os, sys, json, re, time, argparse, unicodedata, configparser
from pathlib import Path

try:
    import requests
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    print("ERROR: Falta requests.  Ejecuta:  pip install requests")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN — modifica estos valores con tus credenciales de ElevenLabs
# ══════════════════════════════════════════════════════════════════════════

config = configparser.RawConfigParser()
config.read('Configuration.properties')

details_dict = dict(config.items('ElevenLabs'))

ELEVEN_API_KEY  = details_dict['key']   # ← pega aquí tu API key de ElevenLabs
ELEVEN_VOICE_ID = details_dict['voice']   # ← Carmelo - Mysterious & Deep

# ── Configuración ElevenLabs ──────────────────────────────────────────────

ELEVEN_API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

# Ajustes de voz recomendados para narrador épico.
# Puedes tunear estos valores tras escuchar los primeros audios.
VOICE_SETTINGS = {
    "stability":         0.55,   # 0-1: más alto = más consistente, menos expresivo
    "similarity_boost":  0.80,   # 0-1: fidelidad a la voz original
    "style":             0.35,   # 0-1: intensidad de estilo (solo modelos v2+)
    "use_speaker_boost": True,   # mejora la claridad de la voz
}

MODEL_ID = "eleven_turbo_v2_5"  # compatible con plan free, excelente calidad en español

# ── Pre-procesado del texto ───────────────────────────────────────────────

# Marcadores especiales que no deben sintetizarse
_SKIP_MARKERS = re.compile(
    r'\[pausa\s+\w+\]|\[Reglas\s+Especiales\]|\[pausa\]',
    re.IGNORECASE
)
# Separar el texto en bloques: texto narrativo vs marcadores de pausa/reglas
def split_blocks(text):
    """
    Devuelve lista de dicts: {"type": "narration"|"pause"|"rules", "text": str}
    El audio se genera solo para bloques de narración.
    Los marcadores de pausa y reglas se ignoran en la síntesis.
    """
    blocks = []
    pos = 0
    for m in _SKIP_MARKERS.finditer(text):
        before = text[pos:m.start()].strip()
        if before:
            blocks.append({"type": "narration", "text": before})
        marker = m.group().lower()
        if "pausa" in marker:
            blocks.append({"type": "pause", "text": m.group()})
        else:
            blocks.append({"type": "rules", "text": m.group()})
        pos = m.end()
    tail = text[pos:].strip()
    if tail:
        blocks.append({"type": "narration", "text": tail})
    return blocks

def clean_for_tts(text):
    """Limpia el texto antes de enviarlo a ElevenLabs."""
    # Eliminar marcadores residuales
    text = _SKIP_MARKERS.sub("", text)
    # Normalizar saltos de línea dobles como pausa natural
    text = re.sub(r'\n{2,}', '\n', text)
    # Salto simple → espacio
    text = re.sub(r'\n', ' ', text)
    # Espacios múltiples
    text = re.sub(r'  +', ' ', text)
    return text.strip()

# ── Nombres de fichero ────────────────────────────────────────────────────

def slugify(text):
    """Convierte un título en nombre de fichero seguro."""
    text = unicodedata.normalize('NFD', text.lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')

def sc_dir(out_dir, sc_num):
    d = Path(out_dir) / f"sc{sc_num}"
    d.mkdir(parents=True, exist_ok=True)
    return d

# ── ElevenLabs API ────────────────────────────────────────────────────────

def synthesize(text, voice_id, api_key):
    """Llama a ElevenLabs y devuelve bytes MP3."""
    url = ELEVEN_API_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key":   api_key,
        "Content-Type": "application/json",
        "Accept":       "audio/mpeg",
    }
    payload = {
        "text":           clean_for_tts(text),
        "model_id":       MODEL_ID,
        "voice_settings": VOICE_SETTINGS,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=60, verify=False)
    if resp.status_code == 401:
        print("\n  ERROR 401: API key inválida o sin permisos.")
        sys.exit(1)
    if resp.status_code == 422:
        print(f"\n  ERROR 422: Texto rechazado por ElevenLabs.")
        print(f"  Detalle: {resp.text[:300]}")
        return None
    if resp.status_code == 429:
        print("\n  RATE LIMIT alcanzado. Esperando 60 segundos...")
        time.sleep(60)
        return synthesize(text, voice_id, api_key)  # reintentar
    resp.raise_for_status()
    return resp.content

# ── Generación ────────────────────────────────────────────────────────────

def generate_all(data, voice_id, api_key, out_dir, from_sc=1, sc_list=None, delay=0.5, dry_run=False):
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    manifest = {}
    total_chars = 0
    total_files = 0
    skipped = 0

    sc_nums = sorted(data.keys(), key=lambda x: int(x))

    for sc_num in sc_nums:
        n = int(sc_num)
        if sc_list is not None:
            if n not in sc_list:
                continue
        elif n < from_sc:
            continue

        sc = data[sc_num]
        sc_name = sc.get("nombre", f"Escenario {sc_num}")
        manifest[sc_num] = {"nombre": sc_name, "secciones": {}}

        print(f"\n── SC #{sc_num}: {sc_name} ──")

        d = sc_dir(out_dir, sc_num)

        for sec in sc["secciones"]:
            titulo = sec["titulo"]
            texto  = sec["texto"]
            slug   = slugify(titulo)
            mp3_path = d / f"{slug}.mp3"

            # Dividir en bloques para saber qué texto va al TTS
            blocks = split_blocks(texto)
            narration_text = " ".join(
                b["text"] for b in blocks if b["type"] == "narration"
            ).strip()

            if not narration_text:
                print(f"  [SKIP] {titulo} — sin texto narrativo")
                skipped += 1
                continue

            chars = len(narration_text)
            total_chars += chars

            if mp3_path.exists():
                print(f"  [EXISTS] {slug}.mp3 ({chars} chars) — omitido")
                manifest[sc_num]["secciones"][slug] = str(mp3_path.relative_to(out_path))
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY] {slug}.mp3  {chars} chars")
                manifest[sc_num]["secciones"][slug] = str(mp3_path.relative_to(out_path))
                continue

            print(f"  → {slug}.mp3  {chars} chars... ", end="", flush=True)
            try:
                mp3 = synthesize(narration_text, voice_id, api_key)
                if mp3:
                    mp3_path.write_bytes(mp3)
                    kb = len(mp3) // 1024
                    print(f"OK ({kb} KB)")
                    manifest[sc_num]["secciones"][slug] = str(mp3_path.relative_to(out_path))
                    total_files += 1
                else:
                    print("ERROR (texto rechazado)")
            except Exception as e:
                print(f"ERROR: {e}")

            time.sleep(delay)

    # Guardar manifest
    manifest_path = out_path / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"""
╔══════════════════════════════════════════╗
║           GENERACIÓN COMPLETADA          ║
╠══════════════════════════════════════════╣
║  Archivos generados : {total_files:<20}║
║  Archivos omitidos  : {skipped:<20}║
║  Caracteres totales : {total_chars:<20,}║
║  Manifest guardado  : {str(manifest_path):<20}║
╚══════════════════════════════════════════╝
""")

# ── CLI ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Pre-genera audio MP3 para todos los escenarios de Gloomhaven usando ElevenLabs."
    )
    parser.add_argument("--api-key",  default=os.environ.get("ELEVEN_API_KEY", ELEVEN_API_KEY),
                        help="API key de ElevenLabs (o env ELEVEN_API_KEY)")
    parser.add_argument("--voice-id", default=os.environ.get("ELEVEN_VOICE_ID", ELEVEN_VOICE_ID),
                        help="ID de la voz elegida en ElevenLabs")
    parser.add_argument("--data",     default="gloomhaven_data.json",
                        help="Ruta al JSON de escenarios (default: gloomhaven_data.json)")
    parser.add_argument("--out",      default="audio",
                        help="Directorio de salida (default: audio/)")
    parser.add_argument("--sc-list",  default="",
                        help="Escenarios concretos separados por comas (ej: 43 o 1,5,12). "
                             "Si se indica, --from-sc se ignora.")
    parser.add_argument("--from-sc",  type=int, default=1,
                        help="Empezar desde el escenario N (para resumir)")
    parser.add_argument("--delay",    type=float, default=0.5,
                        help="Segundos entre peticiones (default: 0.5)")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Simula sin hacer peticiones reales")
    args = parser.parse_args()

    # Validaciones
    if not args.dry_run:
        if not args.api_key:
            print("ERROR: Falta --api-key o variable ELEVEN_API_KEY")
            sys.exit(1)
        if not args.voice_id:
            print("ERROR: Falta --voice-id o variable ELEVEN_VOICE_ID")
            sys.exit(1)

    # Parsear --sc-list
    sc_list = None
    if args.sc_list.strip():
        try:
            sc_list = [int(x.strip()) for x in args.sc_list.split(",") if x.strip()]
        except ValueError:
            print("ERROR: --sc-list debe ser números separados por comas (ej: 43 o 1,5,12)")
            sys.exit(1)

    if not Path(args.data).exists():
        print(f"ERROR: No se encuentra '{args.data}'")
        sys.exit(1)

    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)

    # Filtrar data según sc_list para la estimación
    data_filtrada = {k: v for k, v in data.items()
                     if sc_list is None or int(k) in sc_list}

    sc_label = f"{sorted(sc_list)}" if sc_list else f"todos (desde #{args.from_sc})"

    print(f"""
Gloomhaven — Generador de audio ElevenLabs
─────────────────────────────────────────
  Escenarios  : {len(data_filtrada)} ({sc_label})
  Voice ID    : {args.voice_id or '(dry-run)'}
  Modelo      : {MODEL_ID}
  Salida      : {args.out}/
  Delay       : {args.delay}s
  Dry run     : {args.dry_run}
─────────────────────────────────────────
""")

    if not args.dry_run:
        total = sum(
            len(re.sub(r'\[.*?\]', '', s["texto"]).strip())
            for sc in data_filtrada.values()
            for s in sc["secciones"]
        )
        print(f"  Caracteres a enviar : ~{total:,}")
        print(f"  (se descontarán de tu cuota mensual de créditos)")
        print()
        resp = input("  ¿Continuar? [s/N] ")
        if resp.lower() not in ("s", "si", "sí", "y", "yes"):
            print("Abortado.")
            sys.exit(0)

    generate_all(
        data       = data,
        voice_id   = args.voice_id,
        api_key    = args.api_key,
        out_dir    = args.out,
        from_sc    = args.from_sc,
        sc_list    = sc_list,
        delay      = args.delay,
        dry_run    = args.dry_run,
    )

if __name__ == "__main__":
    main()
