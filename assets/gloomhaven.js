// ── ISLA DE MÚSICA FLOTANTE ─────────────────────────────────────────────

// Supabase client placeholders and initializer (moved from HTML)
// TODO: replace with your Supabase public values in production
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-public-anon-key';
// Expose config so client code can inspect whether values are placeholders
window.__SUPABASE_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY };

(async function(){
  try {
    // Try to obtain real values from serverless /api/env (vercel dev will read .env.local)
    const r = await fetch('/api/env');
    if (r.ok) {
      const cfg = await r.json();
      const url = cfg.SUPABASE_URL || SUPABASE_URL;
      const key = cfg.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
      if (url && key && !url.includes('your-project.supabase.co') && !key.includes('your-public-anon-key') && typeof supabase !== 'undefined') {
        try { window.supabaseClient = supabase.createClient(url, key); } catch(e) { console.warn('Error creating supabase client', e); }
      } else {
        console.warn('Supabase config not provided by /api/env or still placeholders');
      }
    }
  } catch(e) {
    console.warn('Error fetching /api/env', e);
  } finally {
    // Notify client code that supabase availability may have changed
    try { window.dispatchEvent(new Event('supabase-ready')); } catch(e){}
  }
})();
function toggleMusicBar() {
  const bar = document.getElementById('musicBar');
  const fab = document.getElementById('musicFab');
  const isOpen = bar.classList.toggle('open');
  // Forzar reflow para asegurar la transición
  void bar.offsetWidth;
  if (isOpen) {
    // Let CSS anchor the bar to the right of the screen
    bar.style.right = '';
    setTimeout(() => fab.classList.add('hide'), 10);
  } else {
    fab.classList.remove('hide');
    // remove inline right so CSS closed state (off-screen) applies
    bar.style.right = '';
  }
}
// Cierra la barra si se hace click fuera de ella
document.addEventListener('mousedown', function(e) {
  const bar = document.getElementById('musicBar');
  const fab = document.getElementById('musicFab');
  if (!bar.classList.contains('open')) return;
  if (!bar.contains(e.target)) {
    bar.classList.remove('open');
    // clear inline right so it slides back off-screen
    bar.style.right = '';
    setTimeout(() => fab.classList.remove('hide'), 180);
  }
});
let DATA = null;
let NUMS = [];
// En producción dejamos TTS_URL vacío para usar rutas relativas (/api/...) en el dominio desplegado.
// Para pruebas locales con el servidor Python deja 'http://localhost:7532'
const TTS_URL = '';
let cur=null, secIdx=0, playing=false, audio=null, pendingPlayTimeout=null, pendingCanplayListener=null, pendingPlayingListener=null, pendingFallbackTimeout=null, rate=0.9;
let ttsMode='browser';
// Credenciales introducidas por el usuario en el flujo de descarga
let userElevenApiKey = null;
let userElevenVoiceId = null;

// Supabase client (global lib may create `supabase`; use a local name to avoid redeclaration errors)
let supabaseClient = null;

// --- Auth & credentials helpers (Supabase) ---
async function initAuth() {
  if (!supabaseClient) return;
  // render initial state
  await renderAuthPanel();
  // subscribe to auth changes
  supabaseClient.auth.onAuthStateChange(() => {
    renderAuthPanel();
  });
}

function openAuthModal() {
  const m = document.getElementById('authModal');
  if (m) {
    m.style.display = 'block';
    m.classList.remove('closing');
    // force reflow then open (triggers CSS transition)
    void m.offsetWidth;
    m.classList.add('open');
    try { /* don't remove overlay yet; keep until close anim */ } catch(e) {}
    // focus the email input for convenience
    setTimeout(function(){ const e = document.getElementById('authEmail'); if (e) e.focus(); }, 40);
    // attach listeners for outside click and Escape
    document.addEventListener('mousedown', modalOutsideClick);
    document.addEventListener('keydown', modalKeyDown);
    try { document.body.classList.add('modal-open'); } catch(e) {}
  }
  renderAuthPanel();
}

function closeAuthModal(){
  const m = document.getElementById('authModal');
  if (!m) return;
  // remove open, add closing to run exit animation
  m.classList.remove('open');
  m.classList.add('closing');
  // detach listeners
  document.removeEventListener('mousedown', modalOutsideClick);
  document.removeEventListener('keydown', modalKeyDown);
  // wait for transition to finish before hiding and removing overlay
  const onEnd = function(ev) {
    if (ev.propertyName === 'opacity' || ev.propertyName === 'transform') {
      try { m.style.display = 'none'; } catch(e) {}
      try { document.body.classList.remove('modal-open'); } catch(e) {}
      m.classList.remove('closing');
      m.removeEventListener('transitionend', onEnd);
    }
  };
  m.addEventListener('transitionend', onEnd);
  // fallback: ensure it hides after 350ms
  setTimeout(function(){ if (m && m.classList.contains('closing')) { try{ m.style.display='none'; document.body.classList.remove('modal-open'); m.classList.remove('closing'); } catch(e){} } }, 400);
}

// Close modal if clicking outside its content
// Close modal if clicking outside its content
function modalOutsideClick(e) {
  const m = document.getElementById('authModal');
  if (!m) return;
  if (m.style.display !== 'block') return;
  if (!m.contains(e.target)) closeAuthModal();
}

// Close modal on Escape
function modalKeyDown(e) {
  if (e.key === 'Escape' || e.key === 'Esc') closeAuthModal();
}

async function renderAuthPanel() {
  // Ensure the auth button is visible (it opens the modal)
  const btn = document.getElementById('btnAuth'); if (btn) btn.style.display = '';
  const forms = document.getElementById('authForms');
  const panel = document.getElementById('credPanel');
  const msg = document.getElementById('authMsg'); if(msg) msg.textContent='';

  if (!supabaseClient) {
    // Supabase not configured — show the forms but disable auth actions
    if (forms) forms.style.display='block';
    if (panel) panel.style.display='none';
    if (msg) msg.textContent = 'Supabase no configurado. El login no estará disponible hasta configurar las variables.';
    // hide logout button if present
    const logoutBtn = document.getElementById('btnLogout'); if (logoutBtn) logoutBtn.style.display = 'none';
    return;
  }

  const userRes = await supabaseClient.auth.getUser();
  const user = userRes?.data?.user || null;
  if (user) {
    if (forms) forms.style.display='none';
    if (panel) panel.style.display='block';
    // load saved credentials (also reads display_name column if present)
    await loadSavedCredentials();
    const k = document.getElementById('elevenKey'); const v = document.getElementById('elevenVoice');
    if (k) k.value = userElevenApiKey || '';
    if (v) v.value = userElevenVoiceId || '';
    // populate display name from user metadata (or fallback to stored value or email localpart)
    const dn = document.getElementById('displayName');
    const metaName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || '';
    const headerName = metaName || (user?.email ? user.email : '');
    if (dn) dn.value = headerName || '';
    const logoutBtn = document.getElementById('btnLogout'); if (logoutBtn) logoutBtn.style.display = '';
    // update header button to show display name or email
    const btn = document.getElementById('btnAuth'); if (btn) btn.textContent = headerName || (user?.email || 'Acceder');
  } else {
    if (forms) forms.style.display='block';
    if (panel) panel.style.display='none';
    if (msg) msg.textContent = '';
    const logoutBtn = document.getElementById('btnLogout'); if (logoutBtn) logoutBtn.style.display = 'none';
    const btn = document.getElementById('btnAuth'); if (btn) btn.textContent = 'Acceder';
  }
}


async function signUpFromModal() {
  const msg = document.getElementById('authMsg'); if (msg) msg.textContent = '';
  const email = document.getElementById('authEmail') ? document.getElementById('authEmail').value.trim() : '';
  const pass  = document.getElementById('authPass') ? document.getElementById('authPass').value : '';
  const regEl = document.getElementById('regDisplayName') || document.getElementById('displayName');
  const display = regEl ? (regEl.value || '').trim() : null;
  if (!email || !pass) { if (msg) msg.textContent = 'Introduce email y contraseña.'; return; }

  // Helper to create user via admin endpoint and then attempt sign-in
  async function tryCreateAndSignIn() {
    try {
      const r = await fetch('/api/admin-create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass, display_name: display })
      });
      const body = await r.json().catch(() => null);

      if (r.ok && body && (body.ok || body.user)) {
        banner('Usuario creado. Iniciando sesión...', 'ok');
        if (!supabaseClient) { banner('Usuario creado. Recarga la página para iniciar sesión automáticamente.', 'warn'); return false; }
        const { data: sessionData, error: signErr } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (signErr) {
          banner('Usuario creado pero el inicio de sesión automático falló: ' + (signErr.message || String(signErr)), 'warn');
          return false;
        } else {
          // Autologin after sign-up: keep the modal open so the user can configure credentials
          banner('Cuenta creada y sesión iniciada. Ahora puedes configurar tus credenciales.', 'ok');
          try { await renderAuthPanel(); } catch(e){}
          return true;
        }
      }

      // If creation failed because user exists, try sign-in
      const errText = body && (body.error || body.message || JSON.stringify(body)) || '';
      const createdExists = r.status === 400 || r.status === 409 || String(errText).toLowerCase().includes('already') || String(errText).toLowerCase().includes('exists');
      if (createdExists) {
        banner('La cuenta ya existe. Intentando iniciar sesión...', 'warn');
        if (!supabaseClient) { banner('La cuenta existe — configura Supabase para iniciar sesión.', 'warn'); return false; }
        const { data: sd, error: se } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (se) { banner('Inicio de sesión falló: ' + (se.message || String(se)), 'error'); return false; }
        else { banner('Sesión iniciada', 'ok'); try{ await renderAuthPanel(); }catch(e){} try{ closeAuthModal(); }catch(e){}; return true; }
      }

      if (msg) msg.textContent = (body && (body.error || body.message)) ? String(body.error || body.message) : ('Error creando usuario (' + (r.status || '??') + ')');
      return false;
    } catch (e) {
      if (msg) msg.textContent = 'Error de conexión: ' + (e.message || String(e));
      return false;
    }
  }

  // First ask server whether the email is already registered (server uses service-role key)
  let exists = null;
  try {
    const r = await fetch('/api/check-user?email=' + encodeURIComponent(email));
    if (r.ok) {
      const b = await r.json().catch(() => null);
      exists = !!(b && b.exists);
    }
  } catch (e) {
    // ignore — we'll fallback to create logic below
  }

  // If exists === true then try sign-in directly; if sign-in fails with invalid credentials, attempt create
  if (exists === true) {
    if (!supabaseClient) { banner('Supabase no configurado. Imposible iniciar sesión.', 'warn'); return; }
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    if (!error) { banner('Sesión iniciada', 'ok'); await renderAuthPanel(); try{ closeAuthModal(); }catch(e){}; return; }
    const emsg = (error && (error.message || error.toString())) || '';
    // If credentials are invalid, perhaps the check endpoint gave a false positive — try creating the user
    if (/invalid/i.test(emsg) || /password/i.test(emsg)) {
      await tryCreateAndSignIn();
      return;
    }
    banner(emsg || 'Error iniciando sesión', 'error');
    return;
  }

  // Otherwise attempt to create the user
  await tryCreateAndSignIn();
}

async function signInFromModal() {
  if (!supabaseClient) { banner('Supabase no configurado. Imposible iniciar sesión.', 'warn'); return; }
  const email = (document.getElementById('authEmail')?.value || '').trim();
  const pass  = (document.getElementById('authPass')?.value || '');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
  if (error) {
    banner(error.message || error.toString(), 'error');
  } else {
    banner('Sesión iniciada', 'ok');
    try { await renderAuthPanel(); } catch(e){}
    try { closeAuthModal(); } catch(e){}
  }
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  await renderAuthPanel();
  try { closeAuthModal(); } catch(e) {}
}

async function saveDisplayName() {
  if (!supabaseClient) return alert('Supabase no configurado');
  const input = document.getElementById('displayName');
  const name = input ? (input.value || '').trim() : '';
  if (!name) { banner('Introduce un nombre para mostrar.', 'warn'); return; }
  try {
    const { data, error } = await supabaseClient.auth.updateUser({ data: { display_name: name } });
    if (error) {
      banner('Error actualizando nombre: ' + (error.message || String(error)), 'error');
    } else {
      banner('Nombre actualizado', 'ok');
      await renderAuthPanel();
    }
  } catch (e) {
    banner('Error actualizando nombre: ' + (e.message || String(e)), 'error');
  }
}

async function saveProfileAndCredentials() {
  if (!supabaseClient) { banner('Supabase no configurado. Imposible guardar.', 'warn'); return; }
  const name = (document.getElementById('displayName')?.value || '').trim();
  const key  = (document.getElementById('elevenKey')?.value || '').trim();
  const vid  = (document.getElementById('elevenVoice')?.value || '').trim();
  const parts = [];
  let ok = true;

  if (name) {
    try {
      const { data, error } = await supabaseClient.auth.updateUser({ data: { display_name: name } });
      if (error) {
        ok = false;
        parts.push('Error guardando nombre: ' + (error.message || String(error)));
      } else {
        parts.push('Nombre guardado');
      }
    } catch (e) {
      ok = false;
      parts.push('Error guardando nombre: ' + (e.message || String(e)));
    }
  }

  try {
    const { data: u } = await supabaseClient.auth.getUser();
    const user = u?.user || u;
    if (!user) {
      ok = false;
      parts.push('Inicia sesión para guardar credenciales');
    } else {
      const payload = { user_id: user.id, eleven_api_key: key || null, eleven_voice_id: vid || null, updated_at: new Date().toISOString() };
      const { error } = await supabaseClient.from('user_credentials').upsert(payload, { returning: 'minimal' });
      if (error) {
        ok = false;
        parts.push('Error guardando credenciales: ' + (error.message || String(error)));
      } else {
        userElevenApiKey = key;
        userElevenVoiceId = vid;
        parts.push('Credenciales guardadas');
      }
    }
  } catch (e) {
    ok = false;
    parts.push('Error guardando credenciales: ' + (e.message || String(e)));
  }

  banner(parts.join(' • '), ok ? 'ok' : 'warn');
  try { await renderAuthPanel(); } catch(e){}
}

async function saveUserCredentials() {
  if (!supabaseClient) return alert('Supabase no configurado');
  const key = (document.getElementById('elevenKey')?.value || '').trim();
  const vid = (document.getElementById('elevenVoice')?.value || '').trim();
  try {
    const { data: u } = await supabaseClient.auth.getUser();
    const user = u?.user || u;
    if (!user) { banner('Inicia sesión para guardar credenciales', 'warn'); return; }
    const payload = { user_id: user.id, eleven_api_key: key || null, eleven_voice_id: vid || null, updated_at: new Date().toISOString() };
    const { error } = await supabaseClient.from('user_credentials').upsert(payload, { returning: 'minimal' });
    if (error) { banner('Error guardando credenciales: ' + (error.message || String(error)), 'error'); }
    else { userElevenApiKey = key; userElevenVoiceId = vid; banner('Credenciales guardadas', 'ok'); }
  } catch (e) {
    banner('Error guardando credenciales: ' + (e.message || String(e)), 'error');
  }
}

async function deleteUserCredentials() {
  if (!supabaseClient) return alert('Supabase no configurado');
  try {
    const { data: u } = await supabaseClient.auth.getUser();
    const user = u?.user || u;
    if (!user) { banner('Inicia sesión primero', 'warn'); return; }
    const { error } = await supabaseClient.from('user_credentials').delete().eq('user_id', user.id);
    if (error) { banner(error.message || String(error), 'error'); }
    else { banner('Credenciales borradas', 'ok'); userElevenApiKey = null; userElevenVoiceId = null; document.getElementById('elevenKey').value=''; document.getElementById('elevenVoice').value=''; }
  } catch (e) {
    banner('Error borrando credenciales: ' + (e.message || String(e)), 'error');
  }
}

async function loadSavedCredentials(){
  if (!supabaseClient) return;
  const { data: u } = await supabaseClient.auth.getUser();
  const user = u?.user || u;
  if (!user) return null;
  const { data, error } = await supabaseClient.from('user_credentials').select('eleven_api_key, eleven_voice_id').eq('user_id', user.id).single();
  if (!error && data) { userElevenApiKey = data.eleven_api_key || null; userElevenVoiceId = data.eleven_voice_id || null; return data; }
  return null;
}


async function loadScenarioData() {
  try {
    const resp = await fetch('assets/gloomhaven_data.json');
    if (!resp.ok) throw new Error('No se pudo cargar assets/gloomhaven_data.json');
    DATA = await resp.json();
    NUMS = Object.keys(DATA).sort((a,b)=>parseInt(a)-parseInt(b));
    init();
  } catch(e) {
    banner('Error cargando datos: '+e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', function() {
  // If the page (gloomhaven.html) created a global Supabase client, pick it up now
  try {
    if (typeof window !== 'undefined' && window.supabaseClient) supabaseClient = window.supabaseClient;
  } catch (e) {}
  loadScenarioData();
  initAuth();
  // header button uses inline onclick to open the modal
});

// If supabase client is created after DOMContentLoaded, listen for the event
window.addEventListener && window.addEventListener('supabase-ready', function(){
  try { if (typeof window !== 'undefined' && window.supabaseClient) supabaseClient = window.supabaseClient; } catch(e){}
  try { initAuth(); } catch(e){}
});

// ── Edge TTS server check ─────────────────────────────────────────────────
async function checkPiper() {
  try {
    const endpoint = TTS_URL.includes('localhost') ? '/voices' : '/api/voices';
    const r = await fetch(TTS_URL.replace(/\/$/, '') + endpoint, {signal: AbortSignal.timeout(1800)});
    if (r.ok) {
      ttsMode = 'piper';
      banner('Servidor TTS activo', 'ok');
      return;
    }
  } catch(e) {}
  ttsMode = 'browser';
  banner('Servidor TTS no encontrado — usando voz del navegador', 'warn');
}

function banner(msg, type) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = 'banner ' + type;
  el.style.display = 'block';
  setTimeout(function(){ el.style.display='none'; }, 4000);
}


// ── List ──────────────────────────────────────────────────────────────────
function filter() { renderList(document.getElementById('q').value.toLowerCase()); }
function renderList(q) {
  q = q || '';
  const el = document.getElementById('list'); el.innerHTML = '';
  NUMS.forEach(function(n) {
    const sc = DATA[n];
    if (q && !sc.nombre.toLowerCase().includes(q) && !n.includes(q)) return;
    const d = document.createElement('div');
    d.className = 'item' + (cur===n ? ' active' : '');
    d.innerHTML = '<span class="num">'+n+'</span><span class="item-name">'+esc(sc.nombre)+'</span>';
    d.onclick = function(){ loadScenario(n); };
    el.appendChild(d);
  });
}

// ── Scenario ──────────────────────────────────────────────────────────────
function loadScenario(n) {
  if (isMobile()) closeSidebar();
  if (playing) stop();
  cur = n; secIdx = 0;
  document.querySelectorAll('.item').forEach(function(el) {
    el.classList.toggle('active', el.querySelector('.num').textContent === n);
  });
  // Refrescar lista para actualizar indicador de progreso
  renderList(document.getElementById('q').value.toLowerCase());
  document.getElementById('ctitle').textContent = '#'+n+' - '+DATA[n].nombre;
  renderTabs(); showSec(0);
  // Animación apertura de libro
  const mainEl = document.querySelector('.main');
  if (mainEl) {
    mainEl.classList.remove('book-open');
    void mainEl.offsetWidth; // reflow
    mainEl.classList.add('book-open');
  }
  refreshAudioIndicator();
}


function formatSecText(rawText) {
  // First escape HTML special chars in entire text
  var text = rawText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Now split by markers (they were already escaped? No - markers use [ ] which don't need escaping)
  var parts = text.split(/\[pausa larga\]/);
  var html = '';
  parts.forEach(function(part, pi) {
    if (pi > 0) {
      html += '<div class="pausa-sep">— ✦ —</div>';
    }
    // Handle [Reglas Especiales] and [Especial Jefe N] within each part
    part = part.replace(/\[Reglas Especiales\]/g, '<div class="reglas-header">&#128220; Reglas Especiales</div>');
    part = part.replace(/\[Especial Jefe (\d+)\]/g, '<div class="reglas-header">&#9876; Especial Jefe $1</div>');
    part = part.replace(/\[Especial Jefe\]/g, '<div class="reglas-header">&#9876; Especial Jefe</div>');
    // Convert newlines to <br>
    part = part.replace(/\n/g, '<br>');
    html += '<span>' + part + '</span>';
  });
  return html;
}

function renderTabs() {
  const el = document.getElementById('tabs'); el.innerHTML = '';
  DATA[cur].secciones.forEach(function(s, i) {
    const t = document.createElement('div');
    t.className = 'tab' + (i===secIdx ? ' active' : '');
    t.innerHTML = '<span class="tab-n">'+(i+1)+'</span>'+esc(s.titulo);
    t.onclick = function(){ if(playing) stop(); showSec(i); };
    el.appendChild(t);
  });
}

function showSec(i) {
  if (!cur) return;
  const secs = DATA[cur].secciones;
  if (i < 0 || i >= secs.length) return;
  secIdx = i;
  document.querySelectorAll('.tab').forEach(function(t, j){ t.classList.toggle('active', j===i); });
  document.getElementById('prog').style.width = (secs.length < 2 ? 100 : i/(secs.length-1)*100) + '%';
  const sec = secs[i];
  const contentEl = document.getElementById('content');
  contentEl.innerHTML =
    '<div class="section-wrap">'+
    '<div class="sec-header"><h2>'+esc(sec.titulo)+'</h2>'+
    '<div class="sec-play-wrap">'+
    '<button class="btn primary" id="secPlayBtn" onclick="toggleSecPlay()">'+
    '<div class="btn-audio-prog" id="audioProgBar"></div>'+
    '<span class="btn-audio-prog-text">▶ Leer sección</span>'+
    '</button>'+
    '</div></div>'+
    '<div class="sec-divider">✦</div>'+
    '<div class="sec-text">'+formatSecText(sec.texto)+'</div></div>';
  // Forzar reflow para que la animación fadeIn se dispare siempre
  const sw = contentEl.querySelector('.section-wrap');
  if (sw) { sw.style.animation='none'; sw.offsetHeight; sw.style.animation=''; }
  contentEl.scrollTop = 0;
  updateBtns();
}

// ── TTS ───────────────────────────────────────────────────────────────────
function toggleSecPlay() { if(playing) stop(); else startTTS(); }

function cleanForTTS(text) {
  // Remove visual markers before sending to TTS
  return text
    .replace(/\[pausa larga\]/g, '   ')
    .replace(/\[Reglas Especiales\]/g, 'Reglas Especiales:')
    .replace(/\[Especial Jefe (\d+)\]/g, 'Especial Jefe $1:')
    .replace(/\[Especial Jefe\]/g, 'Especial Jefe:');
}

async function startTTS() {
  if (!cur) return;
  const sec = DATA[cur].secciones[secIdx];
  if (!sec || !sec.texto) return;
  const txt = cleanForTTS(sec.texto);
  document.getElementById('content').classList.add('tts-playing');

  // Try stored MP3 first (works regardless of ttsMode)
  const secSlug = sec ? slugify(sec.titulo) : '';
  const audioGetEndpoint = TTS_URL.includes('localhost') ? '/audio-get' : '/api/audio-get';
  const audioGetUrl = TTS_URL.replace(/\/$/, '') + audioGetEndpoint + '?sc=' + encodeURIComponent(cur||'') + '&sec=' + encodeURIComponent(secSlug);
  try {
    const r = await fetch(audioGetUrl, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const blob = await r.blob();
      const src = URL.createObjectURL(blob);
      audio = new Audio(src);
      audio.onended = function() {
        musicUnduck();
        playing = false; markTab(false); updateBtns(); btnLoading(false);
        document.getElementById('content').classList.remove('tts-playing');
        try { if (pendingCanplayListener) audio.removeEventListener('canplay', pendingCanplayListener); } catch(e) {}
        try { if (pendingPlayingListener) audio.removeEventListener('playing', pendingPlayingListener); } catch(e) {}
        pendingCanplayListener = null; pendingPlayingListener = null;
        URL.revokeObjectURL(src);
      };
      audio.ontimeupdate = function() {
        if (!audio || !audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        const bar = document.getElementById('audioProgBar');
        if (bar) bar.style.width = pct + '%';
      };
      audio.onerror = function() { musicUnduck(); playing=false; markTab(false); updateBtns(); btnLoading(false); try { if (pendingPlayingListener) audio.removeEventListener('playing', pendingPlayingListener); } catch(e) {} pendingPlayingListener = null; };

      musicDuck();
      playing = true; updateBtns(); markTab(true); btnLoading(true);

      const onCanPlay = function() {
        if (pendingFallbackTimeout) { clearTimeout(pendingFallbackTimeout); pendingFallbackTimeout = null; }
        pendingPlayTimeout = setTimeout(async function() {
          if (audio) {
            try {
              await audio.play();
              btnLoading(false);
            } catch(e) {}
          }
          pendingPlayTimeout = null;
        }, 1000);
        pendingCanplayListener = null;
      };
      pendingCanplayListener = onCanPlay;
      audio.addEventListener('canplay', onCanPlay);

      pendingPlayingListener = function() { try { btnLoading(false); } catch(e) {} };
      audio.addEventListener('playing', pendingPlayingListener);

      pendingFallbackTimeout = setTimeout(function() {
        if (!pendingPlayTimeout) {
          if (audio) {
            audio.play().then(()=>btnLoading(false)).catch(()=>{});
          }
        }
        pendingFallbackTimeout = null;
      }, 2500);

      return;
    }
  } catch(e) {
    // ignore and fall back to TTS generation
  }

  if (ttsMode === 'piper') startPiper(txt);
  else startBrowser(txt);
}


function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── INDICADOR Y DESCARGA DE AUDIO ────────────────────────────────────────

// Devuelve true si TODOS los MP3 del escenario están disponibles en el servidor
async function scAudioReady(scNum) {
  if (!scNum) return false;
  const secs = DATA[scNum] ? DATA[scNum].secciones : [];
  for (const s of secs) {
    const slug = slugify(s.titulo);
    const endpoint = TTS_URL.includes('localhost') ? '/audio-check' : '/api/audio-check';
    const url  = TTS_URL.replace(/\/$/, '') + endpoint + '?sc=' + encodeURIComponent(scNum) + '&sec=' + encodeURIComponent(slug);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return false;
    } catch(e) { return false; }
  }
  return true;
}

// Actualiza el punto y el botón de descarga según el estado
async function refreshAudioIndicator() {
  const dot   = document.getElementById('audioDot');
  const btnDl = document.getElementById('btnDl');
  if (!cur) {
    if (dot) dot.className = 'audio-dot grey';
    if (btnDl) btnDl.style.display = 'none';
    return;
  }
  const ready = await scAudioReady(cur);
  if (ready) {
    dot.className = 'audio-dot green';
    dot.title     = 'Audio descargado y listo';
    btnDl.style.display = 'none';
  } else {
    dot.className = 'audio-dot red';
    dot.title     = 'Audio no disponible';
    btnDl.style.display = '';
  }
  // Actualizar estado del botón Leer según sección actual
}


// Comprueba si el MP3 de la sección actual está disponible
async function secAudioReady() {
  if (!cur) return false;
  const sec  = DATA[cur] && DATA[cur].secciones[secIdx];
  if (!sec) return false;
  const slug = slugify(sec.titulo);
  const endpoint = TTS_URL.includes('localhost') ? '/audio-check' : '/api/audio-check';
  const url  = TTS_URL.replace(/\/$/, '') + endpoint + '?sc=' + encodeURIComponent(cur) + '&sec=' + encodeURIComponent(slug);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch(e) { return false; }
}



// Descarga todos los MP3 del escenario actual llamando al servidor
async function downloadScAudio() {
  if (!cur) return;
  const btnDl = document.getElementById('btnDl');
  const dot   = document.getElementById('audioDot');
  // Pedir credenciales si no se han proporcionado aún en esta sesión
  if (!userElevenApiKey || !userElevenVoiceId) {
    // Intentar cargar credenciales guardadas desde Supabase si está configurado
    if (supabaseClient) {
      await loadSavedCredentials();
    }
    // Si aún no hay credenciales, pedirlas al usuario como fallback
    if (!userElevenApiKey || !userElevenVoiceId) {
      const key = prompt('Introduce tu ElevenLabs API Key (se usará solo en esta sesión):');
      if (!key) { banner('Descarga cancelada: API Key requerida.', 'warn'); return; }
      const vid = prompt('Introduce tu ElevenLabs VOICE ID:');
      if (!vid) { banner('Descarga cancelada: Voice ID requerida.', 'warn'); return; }
      userElevenApiKey = key.trim();
      userElevenVoiceId = vid.trim();
    }
  }

  btnDl.classList.add('busy');
  btnDl.textContent = '⏳ Descargando...';
  dot.className = 'audio-dot grey';

  const secs = DATA[cur] ? DATA[cur].secciones : [];
  let allOk  = true;

  for (const s of secs) {
    const slug = slugify(s.titulo);

    // If the MP3 already exists in storage, skip generation
    try {
      const checkEndpoint = TTS_URL.includes('localhost') ? '/audio-check' : '/api/audio-check';
      const checkUrl = TTS_URL.replace(/\/$/, '') + checkEndpoint + '?sc=' + encodeURIComponent(cur) + '&sec=' + encodeURIComponent(slug);
      const cr = await fetch(checkUrl, { signal: AbortSignal.timeout(2000) });
      if (cr.ok) {
        // already exists — skip
        continue;
      }
    } catch (ee) {
      // proceed to request generation if check failed
    }

    const endpoint = TTS_URL.includes('localhost') ? '/download' : '/api/download_v2';
    const url = TTS_URL.replace(/\/$/, '') + endpoint;
    const payload = {
      sc: cur,
      sec: slug,
      api_key: userElevenApiKey,
      voice_id: userElevenVoiceId
    };
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (supabaseClient) {
        const s = await supabaseClient.auth.getSession();
        const token = s?.data?.session?.access_token || (s?.data?.access_token);
        if (token) headers['Authorization'] = 'Bearer ' + token;
      }
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000)
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.error === 'cost_warning' || body.error === 'no_config') {
          banner('⚠️ ' + body.message, 'warn');
          allOk = false;
          break;
        }
        allOk = false;
      }
    } catch(e) {
      banner('Error de conexión al descargar: ' + e.message, 'warn');
      allOk = false;
      break;
    }
  }

  btnDl.classList.remove('busy');
  btnDl.textContent = '↓ Descargar audio';

  if (allOk) {
    banner('Audio del escenario ' + cur + ' descargado correctamente', 'ok');
  }
  await refreshAudioIndicator();
}

async function startPiper(text) {
  const vk = 'alvaro'; // voz fija Edge TTS
  const sec = DATA[cur] && DATA[cur].secciones[secIdx];
  const secSlug = sec ? slugify(sec.titulo) : '';
  const audioGetEndpoint = TTS_URL.includes('localhost') ? '/audio-get' : '/api/audio-get';
  const audioGetUrl = TTS_URL.replace(/\/$/, '') + audioGetEndpoint + '?sc=' + encodeURIComponent(cur||'') + '&sec=' + encodeURIComponent(secSlug);

  musicDuck();
  playing = true; updateBtns(); markTab(true); btnLoading(true);
  // Try stored MP3 first
  try {
    const r = await fetch(audioGetUrl);
    if (r.ok) {
      const blob = await r.blob();
      const src = URL.createObjectURL(blob);
      audio = new Audio(src);
      audio.onended = function() {
        musicUnduck();
        playing = false; markTab(false); updateBtns(); btnLoading(false);
        document.getElementById('content').classList.remove('tts-playing');
        try { if (pendingCanplayListener) audio.removeEventListener('canplay', pendingCanplayListener); } catch(e) {}
        try { if (pendingPlayingListener) audio.removeEventListener('playing', pendingPlayingListener); } catch(e) {}
        pendingCanplayListener = null; pendingPlayingListener = null;
        URL.revokeObjectURL(src);
      };
      audio.ontimeupdate = function() {
        if (!audio || !audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        const bar = document.getElementById('audioProgBar');
        if (bar) bar.style.width = pct + '%';
      };
      audio.onerror = function() { playing=false; markTab(false); updateBtns(); btnLoading(false); try { if (pendingPlayingListener) audio.removeEventListener('playing', pendingPlayingListener); } catch(e) {} pendingPlayingListener = null; };

      // Play after 'canplay' + 1s for smooth start; fallback after 2500ms
      const onCanPlay = function() {
        if (pendingFallbackTimeout) { clearTimeout(pendingFallbackTimeout); pendingFallbackTimeout = null; }
        pendingPlayTimeout = setTimeout(async function() {
          if (audio) {
            try {
              await audio.play();
              btnLoading(false);
            } catch(e) {}
          }
          pendingPlayTimeout = null;
        }, 1000);
        pendingCanplayListener = null;
      };
      pendingCanplayListener = onCanPlay;
      audio.addEventListener('canplay', onCanPlay);

      pendingPlayingListener = function() { try { btnLoading(false); } catch(e) {} };
      audio.addEventListener('playing', pendingPlayingListener);

      // Fallback in case canplay doesn't fire in time
      pendingFallbackTimeout = setTimeout(function() {
        if (!pendingPlayTimeout) {
          if (audio) {
            audio.play().then(()=>btnLoading(false)).catch(()=>{});
          }
        }
        pendingFallbackTimeout = null;
      }, 2500);

      return;
    }
  } catch (e) {
    // ignore and fall back to Edge TTS
  }

  // Fallback to Edge TTS server
  const url = TTS_URL + '/tts?voice=' + encodeURIComponent(vk) + '&speed=' + rate + '&sc=' + encodeURIComponent(cur||'') + '&sec=' + encodeURIComponent(secSlug) + '&text=' + encodeURIComponent(text);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('fail');
    const blob = await resp.blob();
    const src = URL.createObjectURL(blob);
    audio = new Audio(src);
    audio.onended = function() {
      musicUnduck();
      playing = false; markTab(false); updateBtns(); btnLoading(false);
      document.getElementById('content').classList.remove('tts-playing');
      URL.revokeObjectURL(src);
    };
    audio.ontimeupdate = function() {
      if (!audio || !audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      const bar = document.getElementById('audioProgBar');
      if (bar) bar.style.width = pct + '%';
    };
    audio.onerror = function() { playing=false; markTab(false); updateBtns(); btnLoading(false); };
    btnLoading(false);

    // Play after 'canplay' + 1s for smooth start; fallback after 2500ms
    const onCanPlayFallback = function() {
      if (pendingFallbackTimeout) { clearTimeout(pendingFallbackTimeout); pendingFallbackTimeout = null; }
      pendingPlayTimeout = setTimeout(function() {
        if (audio) audio.play().catch(function(){});
        pendingPlayTimeout = null;
      }, 1000);
      pendingCanplayListener = null;
    };
    pendingCanplayListener = onCanPlayFallback;
    audio.addEventListener('canplay', onCanPlayFallback);
    pendingFallbackTimeout = setTimeout(function() {
      if (!pendingPlayTimeout) {
        if (audio) audio.play().catch(function(){});
      }
      pendingFallbackTimeout = null;
    }, 2500);
  } catch (err) {
    musicUnduck();
    playing=false; markTab(false); updateBtns(); btnLoading(false);
    banner('Error al conectar con Edge TTS. ¿Está el servidor en marcha?', 'warn');
  }
}

function startBrowser(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = rate; utt.lang = 'es-ES';
  const voices = speechSynthesis.getVoices();
  const v = voices.find(function(v){ return v.lang.startsWith('es'); });
  if (v) utt.voice = v;
  utt.onstart = function(){ musicDuck(); playing=true; updateBtns(); markTab(true); };
  utt.onend = function() {
    musicUnduck(); playing=false; markTab(false); updateBtns();
  };
  utt.onerror = function(){ musicUnduck(); playing=false; markTab(false); updateBtns(); };
  speechSynthesis.speak(utt);
}

function stop() {
  if (pendingPlayTimeout) { clearTimeout(pendingPlayTimeout); pendingPlayTimeout = null; }
  if (pendingFallbackTimeout) { clearTimeout(pendingFallbackTimeout); pendingFallbackTimeout = null; }
  if (pendingCanplayListener && audio) { try { audio.removeEventListener('canplay', pendingCanplayListener); } catch(e) {} }
  if (pendingPlayingListener && audio) { try { audio.removeEventListener('playing', pendingPlayingListener); } catch(e) {} }
  pendingCanplayListener = null;
  pendingPlayingListener = null;
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  musicUnduck();
  playing = false; markTab(false); updateBtns(); btnLoading(false);
  document.getElementById('content').classList.remove('tts-playing');
  const bar = document.getElementById('audioProgBar');
  if (bar) bar.style.width = '0%';
}

function btnLoading(on) {
  const secBtn = document.getElementById('secPlayBtn');
  if (secBtn) {
    secBtn.disabled = on;
    secBtn.classList.toggle('loading', on);
    const txt = secBtn.querySelector('.btn-audio-prog-text');
    if (txt) txt.textContent = on ? '⏳ Generando...' : '▶ Leer sección';
    if (!on) updateBtns();
  } else { updateBtns(); }
}

function updateBtns() {
  const secBtn = document.getElementById('secPlayBtn');
  if (!secBtn) return;
  secBtn.className = 'btn primary';
}


function markTab(on) {
  const tabs = document.querySelectorAll('.tab');
  if (!tabs[secIdx]) return;
  if (on) tabs[secIdx].innerHTML += '<span class="anim"><span></span><span></span><span></span></span>';
  else renderTabs();
}


function isMobile() { return window.innerWidth < 640; }

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('btnToggle');
  const overlay = document.getElementById('sidebarOverlay');
  if (isMobile()) {
    const open = sb.classList.toggle('open');
    overlay.classList.toggle('visible', open);
    btn.title = open ? 'Cerrar lista' : 'Mostrar lista';
  } else {
    const c = sb.classList.toggle('collapsed');
    btn.title = c ? 'Mostrar lista' : 'Ocultar lista';
  }
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sb.classList.remove('open');
  overlay.classList.remove('visible');
}

function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('keydown', function(e) {
  if (e.target.tagName==='INPUT') return;
  if (e.code==='Space') { e.preventDefault(); togglePlay(); }
  if (e.code==='ArrowRight') go(1);
  if (e.code==='ArrowLeft') go(-1);
});


// ── MÚSICA AMBIENTAL ──────────────────────────────────────────────────────
const MUSIC_TRACKS = {
  ambient: [
    { title: "Fantascape",          url: "http://soundimage.org/wp-content/uploads/2014/04/Fantascape.mp3" },
    { title: "Some Dreamy Place",   url: "https://soundimage.org/wp-content/uploads/2016/07/Some-Dreamy-Place_v001.mp3" },
    { title: "Fantasy Game BG",     url: "https://soundimage.org/wp-content/uploads/2024/01/Fantasy_Game_Background.wav" },
    { title: "Netherplace",         url: "https://soundimage.org/wp-content/uploads/2024/01/Netherplace.wav" },
  ],
  epic: [
    { title: "RPG Battle Climax",   url: "https://soundimage.org/wp-content/uploads/2016/07/RPG-Battle-Climax_v001.mp3" },
    { title: "Kingdom of Darkness", url: "https://soundimage.org/wp-content/uploads/2017/12/Kingdom-of-Darkness.mp3" },
    { title: "Our Mountain",        url: "https://soundimage.org/wp-content/uploads/2024/01/Our-Mountain_v003.wav" },
  ],
  dark: [
    { title: "Misty Bog",           url: "https://soundimage.org/wp-content/uploads/2024/01/Misty-Bog.wav" },
    { title: "Strange Phenomenon",  url: "https://soundimage.org/wp-content/uploads/2024/01/Strange-Phenomenon.wav" },
    { title: "Kingdom of Darkness", url: "https://soundimage.org/wp-content/uploads/2017/12/Kingdom-of-Darkness.mp3" },
  ],
};

let musicAudio   = new Audio();
let musicPlaying = false;
let musicMode    = 'ambient';
let musicIdx     = 0;

musicAudio.loop   = true;
musicAudio.volume = 0.18;
musicAudio.addEventListener('ended', function() {
  // por si el loop falla en algún navegador
  musicAudio.currentTime = 0;
  musicAudio.play().catch(() => {});
});
musicAudio.addEventListener('error', function() {
  // si la pista falla, saltar a la siguiente
  setTimeout(nextTrack, 500);
});

function currentPlaylist() {
  return MUSIC_TRACKS[musicMode] || MUSIC_TRACKS.ambient;
}

function loadTrack(idx) {
  const list = currentPlaylist();
  musicIdx = ((idx % list.length) + list.length) % list.length;
  const track = list[musicIdx];
  musicAudio.src = track.url;
  document.getElementById('musicTitle').textContent = track.title;
  if (musicPlaying) {
    musicAudio.play().catch(() => {});
  }
}

function toggleMusic() {
  const btn = document.getElementById('btnMusicPlay');
  if (musicPlaying) {
    musicAudio.pause();
    musicPlaying = false;
    btn.textContent = '▶';
    btn.classList.remove('active');
  } else {
    if (!musicAudio.src || musicAudio.src === window.location.href) {
      loadTrack(0);
    }
    musicAudio.play().catch(function(e) {
      banner('No se pudo cargar la música. ¿Hay conexión a internet?', 'warn');
    });
    musicPlaying = true;
    btn.textContent = '⏸';
    btn.classList.add('active');
  }
}

function nextTrack() {
  loadTrack(musicIdx + 1);
}

function setMusicVol(v) {
  musicAudio.volume = parseFloat(v);
}

function setMusicMode(mode) {
  musicMode = mode;
  if (mode === 'off') {
    musicAudio.pause();
    musicPlaying = false;
    document.getElementById('btnMusicPlay').textContent = '▶';
    document.getElementById('btnMusicPlay').classList.remove('active');
    document.getElementById('musicTitle').textContent = 'Sin música';
    return;
  }
  musicIdx = 0;
  loadTrack(0);
  if (!musicPlaying) toggleMusic();
}

// ── Scroll-to-top ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  const contentEl = document.getElementById('content');
  const btnTop = document.getElementById('btnTop');
  if (contentEl && btnTop) {
    contentEl.addEventListener('scroll', function() {
      btnTop.classList.toggle('visible', contentEl.scrollTop > 200);
    });
  }
});

let _preImmersiveVol = null;

function toggleImmersive() {
  const entering = !document.body.classList.contains('immersive');
  const btn = document.getElementById('btnImmersive');

  if (entering) {
    // Fade out de UI antes de ocultar
    document.body.classList.add('immersive-out');
    setTimeout(function() {
      document.body.classList.remove('immersive-out');
      document.body.classList.add('immersive');
      if (btn) btn.classList.add('active');
    }, 380);
    // Subir volumen música si está activa
    if (musicPlaying) {
      _preImmersiveVol = musicAudio.volume;
      const target = Math.min(1, musicAudio.volume * 2.5);
      _fadeVolume(musicAudio, musicAudio.volume, target, 800);
    }
  } else {
    document.body.classList.remove('immersive');
    if (btn) btn.classList.remove('active');
    // Restaurar volumen música
    if (_preImmersiveVol !== null && musicPlaying) {
      _fadeVolume(musicAudio, musicAudio.volume, _preImmersiveVol, 600);
      _preImmersiveVol = null;
    }
  }
}

function _fadeVolume(audioEl, from, to, ms) {
  const steps = 30;
  const interval = ms / steps;
  const delta = (to - from) / steps;
  let step = 0;
  const t = setInterval(function() {
    step++;
    audioEl.volume = Math.max(0, Math.min(1, from + delta * step));
    if (step >= steps) clearInterval(t);
  }, interval);
}

// ── DUCKING DE MÚSICA DURANTE TTS ──────────────────────────────────────────
// Reduce el volumen de la música ambiental mientras se reproduce audio de escenario
const MUSIC_DUCK_RATIO = 0.3;   // bajar al 30% del volumen actual
let _preDuckVol = null;

function musicDuck() {
  if (!musicPlaying || _preDuckVol !== null) return;
  _preDuckVol = musicAudio.volume;
  _fadeVolume(musicAudio, musicAudio.volume, _preDuckVol * MUSIC_DUCK_RATIO, 600);
}

function musicUnduck() {
  if (_preDuckVol === null) return;
  const target = _preDuckVol;
  _preDuckVol = null;
  _fadeVolume(musicAudio, musicAudio.volume, target, 1200);
}

// Teclado en modo inmersivo
document.addEventListener('keydown', function(e) {
  const isImmersive = document.body.classList.contains('immersive');
  if (e.key === 'Escape' && isImmersive) { toggleImmersive(); return; }
  if (!isImmersive) return;
  // No interferir con inputs
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    toggleSecPlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    const secs = cur ? DATA[cur].secciones : [];
    if (secIdx < secs.length - 1) { if(playing) stop(); showSec(secIdx + 1); }
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (secIdx > 0) { if(playing) stop(); showSec(secIdx - 1); }
  }
});

function init() {
  if (!DATA) return;
  NUMS = Object.keys(DATA).sort(function(a,b){ return parseInt(a)-parseInt(b); });
  renderList();
  checkPiper();

}
