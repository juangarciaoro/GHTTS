// ── ISLA DE MÚSICA FLOTANTE ─────────────────────────────────────────────
function toggleMusicBar() {
  const bar = document.getElementById('musicBar');
  const fab = document.getElementById('musicFab');
  const isOpen = bar.classList.toggle('open');
  // Forzar reflow para asegurar la transición
  void bar.offsetWidth;
  if (isOpen) {
    setTimeout(() => fab.classList.add('hide'), 10);
  } else {
    fab.classList.remove('hide');
  }
}
// Cierra la barra si se hace click fuera de ella
document.addEventListener('mousedown', function(e) {
  const bar = document.getElementById('musicBar');
  const fab = document.getElementById('musicFab');
  if (!bar.classList.contains('open')) return;
  if (!bar.contains(e.target)) {
    bar.classList.remove('open');
    setTimeout(() => fab.classList.remove('hide'), 180);
  }
});
let DATA = null;
let NUMS = [];
const TTS_URL = 'http://localhost:7532';
let cur=null, secIdx=0, playing=false, audio=null, rate=0.9;
let ttsMode='browser';
// Credenciales introducidas por el usuario en el flujo de descarga
let userElevenApiKey = null;
let userElevenVoiceId = null;

async function loadScenarioData() {
  try {
    const resp = await fetch('media/gloomhaven_data.json');
    if (!resp.ok) throw new Error('No se pudo cargar gloomhaven_data.json');
    DATA = await resp.json();
    NUMS = Object.keys(DATA).sort((a,b)=>parseInt(a)-parseInt(b));
    init();
  } catch(e) {
    banner('Error cargando datos: '+e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', loadScenarioData);

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

function startTTS() {
  if (!cur) return;
  const sec = DATA[cur].secciones[secIdx];
  if (!sec || !sec.texto) return;
  const txt = cleanForTTS(sec.texto);
  document.getElementById('content').classList.add('tts-playing');
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
  if (!scNum || ttsMode !== 'piper') return false;
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
  if (!cur || ttsMode !== 'piper') {
    dot.className = 'audio-dot grey';
    btnDl.style.display = 'none';
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
  if (!cur || ttsMode !== 'piper') return false;
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
    const key = prompt('Introduce tu ElevenLabs API Key (se usará solo en esta sesión):');
    if (!key) { banner('Descarga cancelada: API Key requerida.', 'warn'); return; }
    const vid = prompt('Introduce tu ElevenLabs VOICE ID:');
    if (!vid) { banner('Descarga cancelada: Voice ID requerida.', 'warn'); return; }
    userElevenApiKey = key.trim();
    userElevenVoiceId = vid.trim();
  }

  btnDl.classList.add('busy');
  btnDl.textContent = '⏳ Descargando...';
  dot.className = 'audio-dot grey';

  const secs = DATA[cur] ? DATA[cur].secciones : [];
  let allOk  = true;

  for (const s of secs) {
    const slug = slugify(s.titulo);
    const endpoint = TTS_URL.includes('localhost') ? '/download' : '/api/download';
    const url = TTS_URL.replace(/\/$/, '') + endpoint;
    const payload = {
      sc: cur,
      sec: slug,
      api_key: userElevenApiKey,
      voice_id: userElevenVoiceId
    };
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

function startPiper(text) {
  const vk = 'alvaro'; // voz fija Edge TTS
  const sec = DATA[cur] && DATA[cur].secciones[secIdx];
  const secSlug = sec ? slugify(sec.titulo) : '';
  const url = TTS_URL+'/tts?voice='+encodeURIComponent(vk)+'&speed='+rate+'&sc='+encodeURIComponent(cur||'')+'&sec='+encodeURIComponent(secSlug)+'&text='+encodeURIComponent(text);
  playing = true; updateBtns(); markTab(true); btnLoading(true);
  fetch(url).then(function(resp) {
    if (!resp.ok) throw new Error('fail');
    return resp.blob();
  }).then(function(blob) {
    const src = URL.createObjectURL(blob);
    audio = new Audio(src);
    audio.onended = function() {
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
    audio.play();
  }).catch(function() {
    playing=false; markTab(false); updateBtns(); btnLoading(false);
    banner('Error al conectar con Edge TTS. ¿Está el servidor en marcha?', 'warn');
  });
}

function startBrowser(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = rate; utt.lang = 'es-ES';
  const voices = speechSynthesis.getVoices();
  const v = voices.find(function(v){ return v.lang.startsWith('es'); });
  if (v) utt.voice = v;
  utt.onstart = function(){ playing=true; updateBtns(); markTab(true); };
  utt.onend = function() {
    playing=false; markTab(false); updateBtns();
  };
  utt.onerror = function(){ playing=false; markTab(false); updateBtns(); };
  speechSynthesis.speak(utt);
}

function stop() {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
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
  NUMS = Object.keys(DATA).sort(function(a,b){ return parseInt(a)-parseInt(b); });
  renderList();
  checkPiper();

}
init();
