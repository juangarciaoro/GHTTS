# 🗡️ Gloomhaven Narrator – Guía de Ejecución

Este proyecto permite narrar eventos de *Gloomhaven* usando una voz generada mediante ElevenLabs.  
Sigue los pasos de este documento para configurar correctamente la aplicación y ejecutarla.

---

## 📦 Requisitos previos

- Python 3.8+
- Cuenta gratuita o de pago en [ElevenLabs](https://elevenlabs.io)
- Navegador web (cualquiera)

---

## 📥 1. Instalación de dependencias necesarias

Para despliegue en Vercel + Supabase usa las dependencias de Node descritas en `package.json` (ya incluye `@supabase/supabase-js`).

Si quieres ejecutar el servidor Python localmente (opcional, solo para pruebas), instala las librerías:

```bash
pip install edge-tts requests pathlib urllib3
```

Estas librerías son usadas por el servidor Python de pruebas:

```python
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
```

---

## ⚙️ 2. Configuración inicial

Opcional — solo si ejecutas `server/servidor.py` localmente: crea una copia de `Configuration.properties.example` y nómbrala `Configuration.properties`:

```
[ElevenLabs]
key = TU_API_KEY_AQUI
voice = TU_VOICE_ID_AQUI
```

### 🔑 API Key de ElevenLabs
1. https://elevenlabs.io/app → **Profile** → **API Keys**
2. Copia la clave y pégala en `key=`

### 🗣️ Voice ID recomendado
Usa este enlace para crear voz similar: [Prompt para crear la voz en ElevenLabs](https://elevenlabs.io/app/voice-lab?action=create&creationType=voiceDesign&prompt=Middle-aged+Spanish+male+voice+from+Spain,+Castilian+accent+(peninsular).+Deep,+smooth+and+resonant+baritone.+Mature,+wise+and+mysterious+tone.+Calm+and+deliberate+pacing+with+natural+gravitas.+Storytelling+quality+—+like+an+experienced+narrator+of+epic+fantasy+audiobooks.+Slightly+low+pitch,+clear+articulation,+subtle+rasp.+Not+theatrical+or+over-dramatic,+but+deeply+immersive+and+authoritative.&previewText=El+hedor+de+la+muerte+y+la+carne+podrida+se+hace+más+intenso+a+medida+que+os+alejáis+de+los+cadáveres+de+vuestros+enemigos+y+os+adentráis+en+el+subterráneo+del+túmulo.&seed=380245&loudness=0.5&guidanceScale=5)

Copia el **Voice ID** a `voice=`

---

## ▶️ 3. **media/** - Archivos multimedia

```
media/
├── audio/                 ← MP3 narrados (sc1/introduccion.mp3)
├── assets/gloomhaven_data.json   ← Textos de escenarios
└── Libro_de_escenarios... ← PDF original
```

---

## 🚀 4. Despliegue en Vercel + Supabase

Para producción con Vercel + Supabase:

- Conserva la carpeta `api/`, `vercel.json` y `package.json` (funciones serverless).
- Configura variables de entorno en Vercel: `SUPABASE_URL`, `SUPABASE_KEY`, `ELEVEN_API_KEY`, `ELEVEN_VOICE_ID` (si usas ElevenLabs).
- En Supabase, crea un bucket para `audio/` y ajusta permisos; las funciones pueden firmar URLs para acceso privado.
- Conecta el repositorio a Vercel y despliega; la ruta raíz ya está rewriteada a `gloomhaven.html`.

Pruebas locales: usa `vercel dev` para emular funciones serverless localmente.

---

## 🌐 5. Interfaz web

Abre `gloomhaven.html` en el navegador.

**Funciona con:**
- Audio en Supabase vía funciones serverless (`/api/audio-get`, `/api/audio-check`)
- ElevenLabs (si configuras `ELEVEN_API_KEY`) o Edge TTS

---

## 🔄 Generar audio masivo (opcional)

```bash
# Nuevo escenario 43
python generar_audio.py --api-key TU_KEY --voice-id TU_VID --sc-list 43

# Todos desde sc10
python generar_audio.py --api-key TU_KEY --voice-id TU_VID --from-sc 10

# Simular (sin créditos)
python generar_audio.py ... --dry-run
```

**Salida:** `media/audio/sc43/conclusion.mp3` + manifest.json
