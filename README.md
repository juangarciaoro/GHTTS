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

Antes de ejecutar `servidor.py`, debes instalar las librerías estándar necesarias mediante `pip`:

```bash
pip install pathlib
pip install httpserver
pip install urllib3
```

> **Nota:** Estas librerías forman parte de la biblioteca estándar de Python, pero algunos entornos requieren instalarlas explícitamente.

Estas son usadas dentro del servidor:

```python
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
```

---

## ⚙️ 2. Configuración inicial

Antes de ejecutar la aplicación debes editar el archivo:

```
Configuration.properties
```

Introduce:

- `key` → Tu clave privada de ElevenLabs  
- `voice` → El identificador de la voz que vayas a utilizar

### 🔑 ¿Cómo obtener tu API Key de ElevenLabs?

1. Accede a: https://elevenlabs.io/app  
2. En el menú lateral, ve a **"Profile"**.  
3. En **"API Keys"**, genera una nueva clave o copia la existente.
4. Pega el valor en `Configuration.properties`:

```
api_key=TU_API_KEY_AQUI
voice_id=EL_VOICE_ID_QUE_CORRESPONDA
```

---

## 🗣️ 3. Obtener tu Voice ID

Para generar una voz similar a la de este proyecto, usa el siguiente enlace (Voice Design):

👉 **https://elevenlabs.io/app/voice-lab?action=create&creationType=voiceDesign&prompt=Middle-aged+Spanish+male+voice+from+Spain,+Castilian+accent+(peninsular).+Deep,+smooth+and+resonant+baritone.+Mature,+wise+and+mysterious+tone.+Calm+and+deliberate+pacing+with+natural+gravitas.+Storytelling+quality+—+like+an+experienced+narrator+of+epic+fantasy+audiobooks.+Slightly+low+pitch,+clear+articulation,+subtle+rasp.+Not+theatrical+or+over-dramatic,+but+deeply+immersive+and+authoritative.&previewText=La+colina+es+bastante+fácil+de+encontrar,+un%0Abreve+trayecto+después+de+pasar+por+la+Puerta%0Adel+Mercado+Nuevo+(New+Market+Gate)%0Ay+alcanzas+a+verla+sobresaliendo+en+la+linde%0Adel+Bosque+Cadavérico+(Coprsewood),+como%0Auna+rata+que+asoma+bajo+una+alfombra.&seed=41146&loudness=0.5&guidanceScale=5**

Después de crearla:

1. En tu panel, entra en **"Voices"**.  
2. Selecciona la voz generada.  
3. Copia el **Voice ID**.  
4. Colócalo en `Configuration.properties`.

---

## ▶️ 4. Ejecutar el servidor local

Con la configuración completa, ejecuta:

```bash
python servidor.py
```

Esto iniciará el servidor local que convierte texto en audio usando ElevenLabs.

---

## 🌐 5. Abrir la interfaz web

Con el servidor funcionando, abre el archivo:

```
gloomhaven.html
```

Se abrirá en cualquier navegador y estará listo para usarse.

---

## 🎉 ¡Listo!

Tu aplicación está completamente configurada y funcionando con narración personalizada.

