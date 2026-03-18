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

Antes de ejecutar `servidor.py`, debes instalar las librerías:

```bash
pip install edge-tts requests pathlib urllib3
```

Estas son usadas dentro del servidor:

```python
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
```

---

## ⚙️ 2. Configuración inicial

Crea una copia de  `Configuration.properties.example` y nombrala `Configuration.properties`:

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
├── gloomhaven_data.json   ← Textos de escenarios
└── Libro_de_escenarios... ← PDF original
```

---

## 🚀 4. Ejecutar servidor

```bash
python servidor.py
```

Servidor en http://localhost:7532

---

## 🌐 5. Interfaz web

Abre `gloomhaven.html` en navegador.

**Funciona con:**
- Audio local: media/audio/sc1/conclusion.mp3
- ElevenLabs (tiempo real)
- Edge TTS (fallback gratis)

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

---

## 🎉 ¡Listo! ✅

✅ Scripts movidos a **server/**
✅ Servidor sirve desde **media/**
✅ UI funciona sin cambios (localhost:7532)

**Probar:** 
1. `cd server && python servidor.py`
2. Abrir `gloomhaven.html` → SC#1 → ▶ "Leer"

**Refactor completado**
