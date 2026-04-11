Despliegue Vercel + Supabase (on-demand TTS)
=============================================

Resumen rápido:
- Vercel alojará el front-end y las funciones serverless (`/api/*`).
- Supabase Storage guardará los MP3 generados.
- Cuando el usuario pulse "Descargar audio" el front llama a `/api/download` (POST) con `api_key` y `voice_id` proporcionados por el usuario; la función genera via ElevenLabs y guarda el MP3 en Supabase.

Pasos detallados (hazlos en este orden):

1) Crear proyecto en Supabase
  - En https://app.supabase.com crea un nuevo proyecto.
  - Ve a la pestaña "Storage" y crea un bucket llamado `audio` (o el nombre que prefieras).
  - Opcional: marcar como público si quieres servir los MP3 directamente con URLs públicas (no obligatorio).
  - Ve a Settings -> API y copia la `URL` del proyecto (`SUPABASE_URL`) y la `Service Role Key` (la necesitarás para subir objetos desde el servidor). Guarda estas dos cosas en un lugar seguro.

2) Preparar el repo para Vercel
  - Conecta tu repositorio GitHub (sube este repo) a Vercel o sube manualmente.
  - En la configuración del proyecto en Vercel, añade las siguientes Variables de Entorno (Environment Variables):
    - `SUPABASE_URL` = la URL de tu proyecto Supabase
    - `SUPABASE_SERVICE_ROLE_KEY` = la Service Role Key (MUST be secret)
    - `SUPABASE_BUCKET` = `audio` (si usaste otro nombre, ponlo aquí)

3) Desplegar en Vercel
  - Vercel instalará dependencias desde `package.json` y desplegará funciones en `/api/*`.
  - Espera a que el despliegue termine y copia la URL del site (ej: `https://mi-gh-tts.vercel.app`).

4) Configurar el front-end
  - Edita `assets/gloomhaven.js` y cambia la constante `TTS_URL` al dominio desplegado:
    - `const TTS_URL = 'https://mi-gh-tts.vercel.app'`
  - (También puedes dejar `http://localhost:7532` para desarrollo local y probar localmente.)

5) Uso
  - Abre la web desplegada.
  - Selecciona un escenario y pulsa "↓ Descargar audio". Te pedirá tu `API Key` y `VOICE ID` de ElevenLabs; introduce esas credenciales.
  - La función serverless llamará a ElevenLabs con las credenciales que has proporcionado, generará el MP3 y lo guardará en Supabase Storage.

Notas y recomendaciones
- Seguridad: las claves de ElevenLabs se envían desde el navegador al endpoint serverless por HTTPS; en Vercel las peticiones están protegidas por TLS. Sin embargo, **no** guardes la `ELEVEN_API_KEY` en el front-end. El bucket de Supabase debe estar protegido con Service Role Key solo en el servidor.
- Costes: ElevenLabs no es gratuito indefinidamente; controla el uso y genera solo lo necesario.
- Límites: Supabase free tier ofrece espacio limitado; monitoriza el tamaño del bucket y considera limpiar archivos antiguos si es necesario.

Si quieres, implemento una variante que devuelva la URL pública del MP3 después de guardarlo (útil para mostrar un enlace de descarga inmediato). ¿La quieres ahora?
