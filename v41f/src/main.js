/* STARFALL · main loop, HUD wiring, scene orchestration */
(function () {
  'use strict';

  const NEB = (window.NEB = window.NEB || {});
  const U = NEB.util;
  const canvas = document.getElementById('gl');
  const bootEl = document.getElementById('boot');
  const bootBar = document.getElementById('boot-bar');
  const bootStatus = document.getElementById('boot-status');
  const pickerEl = document.getElementById('picker');
  const fpsEl = document.getElementById('fps');
  const scaleEl = document.getElementById('scale');
  const sceneIdEl = document.getElementById('scene-id');
  const detailEl = document.getElementById('detail');
  const audioBtn = document.getElementById('audio');
  const audioLbl = audioBtn.querySelector('.audio-lbl');
  const pausedEl = document.getElementById('paused');
  const toastEl = document.getElementById('toast');
  const hudEl = document.getElementById('hud');

  // ---------- GL context ----------
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: true,
  });

  if (!gl) {
    showFatal('当前浏览器不支持 WebGL2 · 无法启动星坠引擎');
    return;
  }
  U.init(gl);
  NEB.gl = gl;
  NEB.view = { w: 0, h: 0 };

  // ---------- state ----------
  const state = {
    cssW: 0, cssH: 0, dpr: 1, scale: 1,
    targetW: 2, targetH: 2,
    time: 0, last: performance.now(), paused: false,
    fade: 0, fadeTarget: 1, pendingScene: null,
    ready: false, bootDone: false, bootStart: performance.now(),
    lost: false, sampleReq: null,
    autoT: 0, idle: false,
    fps: 60, lowTime: 0, perfClock: 0,
  };

  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const qs = new URLSearchParams(location.search);
  state.adaptive = qs.get('adaptive') !== '0';
  const forcedScale = parseFloat(qs.get('scale'));
  if (isFinite(forcedScale) && forcedScale > 0) state.scale = U.clamp(forcedScale, 0.4, 1);
  const audioLevels = { bass: 0, mid: 0, treble: 0, level: 0 };
  const pointer = {
    u: 0.5, v: 0.5, tx: 0.5, ty: 0.5, down: false,
    lastMove: -1e9, pulse: 0, pulseU: 0.5, pulseV: 0.5, wheel: 0,
    prevU: 0.5, prevV: 0.5,
  };
  const input = {
    nx: 0, ny: 0, u: 0.5, v: 0.5, px: 0, py: 0,
    vx: 0, vy: 0, down: false,
    pulse: 0, pulseU: 0.5, pulseV: 0.5,
    wheel: 0, energy: 0, idle: false,
    reducedMotion: reducedMotion,
    audio: audioLevels,
  };

  let sceneTarget = null;
  let post = null;
  let entries = [];
  let current = null;
  let currentIndex = -1;
  let resizeQueued = false;
  let toastTimer = 0;

  // offscreen canvas used by the debug sampler
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 96;
  sampleCanvas.height = 54;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // ---------- HUD helpers ----------
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2600);
  }

  function showFatal(msg) {
    if (bootEl) {
      bootEl.classList.remove('gone');
      const st = bootEl.querySelector('.status');
      if (st) st.textContent = msg;
      const bar = bootEl.querySelector('.bar i');
      if (bar) { bar.style.width = '100%'; bar.style.background = '#ff4d6d'; }
    }
    document.documentElement.style.setProperty('--accent', '#ff4d6d');
  }

  function applyAccent(meta) {
    const root = document.documentElement;
    root.style.setProperty('--accent', meta.accent || '#7df9ff');
    root.style.setProperty('--accent2', meta.accent2 || '#ff4fd8');
    document.body.dataset.scene = meta.id || '';
  }

  function updatePicker() {
    entries.forEach(function (entry, i) {
      if (!entry.btn) return;
      const active = i === currentIndex;
      entry.btn.classList.toggle('active', active);
      if (active) entry.btn.setAttribute('aria-current', 'true');
      else entry.btn.removeAttribute('aria-current');
    });
  }

  function sceneDetail() {
    if (!current) return '—';
    let s = current.stats;
    try { s = typeof s === 'function' ? s() : s; } catch (e) { s = '—'; }
    return s || '—';
  }

  function refreshSceneLabels() {
    if (!current) return;
    applyAccent(current.meta);
    sceneIdEl.textContent = (current.meta.cn || '') + ' / ' + current.meta.title;
    detailEl.textContent = sceneDetail();
    updatePicker();
  }

  // ---------- scene registry ----------
  function collectScenes() {
    const ids = Object.keys(NEB.scenes);
    entries = ids
      .map(function (id) { return NEB.scenes[id]; })
      .filter(function (s) { return s && s.meta && s.meta.id && s.meta.hidden !== true; })
      .map(function (s) {
        return { scene: s, inited: false, failed: false, btn: null };
      });
  }

  function activate(index) {
    const entry = entries[index];
    if (!entry) return false;
    if (entry.scene === current) { currentIndex = index; refreshSceneLabels(); return true; }
    try {
      if (!entry.inited) {
        entry.scene.init(gl, state.targetW, state.targetH);
        entry.inited = true;
      }
      entry.scene.resize(state.targetW, state.targetH);
      if (current && typeof current.onDeactivate === 'function') current.onDeactivate();
      current = entry.scene;
      currentIndex = index;
      if (typeof current.onActivate === 'function') current.onActivate();
      refreshSceneLabels();
      return true;
    } catch (err) {
      entry.failed = true;
      entry.inited = false;
      console.error('[STARFALL] 场景初始化失败:', entry.scene.meta.id, err);
      toast('场景「' + (entry.scene.meta.cn || entry.scene.meta.title) + '」初始化失败');
      return false;
    }
  }

  function requestScene(index) {
    if (!entries[index] || entries[index].failed) return;
    if (index === currentIndex && state.pendingScene === null) return;
    if (!state.bootDone) return;
    state.pendingScene = index;
    state.fadeTarget = 0;
  }

  function switchSceneByKey(key) {
    if (!key) return false;
    const byId = entries.findIndex(function (e) { return e.scene.meta.id === key; });
    if (byId >= 0) { requestScene(byId); return true; }
    const n = parseInt(key, 10);
    if (!isNaN(n) && n >= 1 && n <= entries.length) { requestScene(n - 1); return true; }
    return false;
  }

  // ---------- canvas sizing ----------
  function sizeCanvas() {
    const cw = Math.max(320, window.innerWidth);
    const ch = Math.max(240, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    state.cssW = cw; state.cssH = ch; state.dpr = dpr;

    const scale = state.scale;
    let tw = Math.max(2, Math.round(bw * scale));
    let th = Math.max(2, Math.round(bh * scale));
    const cap = 4.4e6;
    const px = tw * th;
    if (px > cap) {
      const k = Math.sqrt(cap / px);
      tw = Math.max(2, Math.round(tw * k));
      th = Math.max(2, Math.round(th * k));
    }
    state.targetW = tw; state.targetH = th;
    NEB.view.w = tw; NEB.view.h = th;
  }

  function resize() {
    sizeCanvas();
    if (!sceneTarget) {
      sceneTarget = U.target(gl, state.targetW, state.targetH, { filter: gl.LINEAR });
      post = new NEB.Post(gl, state.targetW, state.targetH);
    } else {
      sceneTarget.resize(state.targetW, state.targetH);
      post.resize(state.targetW, state.targetH);
    }
    if (current) {
      try { current.resize(state.targetW, state.targetH); }
      catch (err) { console.error('[STARFALL] 场景 resize 失败:', err); }
    }
    if (scaleEl) scaleEl.textContent = Math.round(state.scale * 100) + '%';
    updateAudioLevels();
  }

  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () {
      resizeQueued = false;
      resize();
    });
  }

  window.addEventListener('resize', queueResize);

  // ---------- pointer input ----------
  function pointToUv(x, y) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      u: U.clamp((x - rect.left) / rect.width, 0, 1),
      v: U.clamp(1 - (y - rect.top) / rect.height, 0, 1),
    };
  }

  window.addEventListener('pointermove', function (e) {
    const uv = pointToUv(e.clientX, e.clientY);
    if (!uv) return;
    pointer.tx = uv.u; pointer.ty = uv.v;
    pointer.lastMove = performance.now();
    if (pointer.down) { pointer.pulseU = uv.u; pointer.pulseV = uv.v; }
  }, { passive: true });

  canvas.addEventListener('pointerdown', function (e) {
    const uv = pointToUv(e.clientX, e.clientY);
    pointer.down = true;
    if (uv) {
      pointer.tx = uv.u; pointer.ty = uv.v;
      pointer.pulseU = uv.u; pointer.pulseV = uv.v;
    }
    pointer.pulse = 1;
    pointer.lastMove = performance.now();
    if (e.pointerId !== undefined && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
  });

  window.addEventListener('pointerup', function () { pointer.down = false; });
  window.addEventListener('pointercancel', function () { pointer.down = false; });
  window.addEventListener('blur', function () { pointer.down = false; });

  canvas.addEventListener('wheel', function (e) {
    pointer.wheel += e.deltaY;
    pointer.lastMove = performance.now();
    e.preventDefault();
  }, { passive: false });

  // ---------- keyboard ----------
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') {
      e.preventDefault();
      setPaused(!state.paused);
      return;
    }
    if (k === 'h' || k === 'H') { document.body.classList.toggle('hide-hud'); return; }
    if (k === 'f' || k === 'F') { toggleFullscreen(); return; }
    if (k === 'm' || k === 'M') { toggleAudio(); return; }
    if (k === 'r' || k === 'R') {
      if (current && typeof current.onReseed === 'function') {
        current.onReseed();
        toast('已重新播种 · RESEED');
      }
      return;
    }
    if (k >= '1' && k <= '9') { switchSceneByKey(k); return; }
  });

  function setPaused(v) {
    state.paused = !!v;
    state.last = performance.now();
    pausedEl.hidden = !state.paused;
    document.body.classList.toggle('paused', state.paused);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () { toast('全屏被浏览器拒绝'); });
    }
  }

  // ---------- audio ----------
  function updateAudioLevels() {
    let s = null;
    if (NEB.Audio && NEB.Audio.on && typeof NEB.Audio.sample === 'function') {
      try { s = NEB.Audio.sample(); } catch (err) { s = null; }
    }
    audioLevels.bass = s && s.bass || 0;
    audioLevels.mid = s && s.mid || 0;
    audioLevels.treble = s && s.treble || 0;
    audioLevels.level = s && s.level || 0;
  }

  async function toggleAudio() {
    if (!NEB.Audio || typeof NEB.Audio.toggle !== 'function' || NEB.Audio.ready === false) {
      toast('该环境不支持氛围音频');
      return false;
    }
    try {
      const on = await NEB.Audio.toggle();
      audioBtn.classList.toggle('on', !!on);
      audioBtn.setAttribute('aria-pressed', String(!!on));
      audioLbl.textContent = on ? 'AMBIENT · ON' : 'AMBIENT · OFF';
      toast(on ? '氛围音频已开启 · 画面将随声而动' : '氛围音频已关闭');
      return !!on;
    } catch (err) {
      console.error('[STARFALL] audio toggle failed:', err);
      toast('音频启动失败');
      return false;
    }
  }
  audioBtn.addEventListener('click', function () { toggleAudio(); });

  // ---------- HUD build ----------
  function buildPicker() {
    pickerEl.innerHTML = '';
    entries.forEach(function (entry, i) {
      const meta = entry.scene.meta;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.innerHTML =
        '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="t">' + meta.title + '</span>' +
        '<span class="cn">' + (meta.cn || '') + '</span>';
      btn.addEventListener('click', function () { requestScene(i); });
      pickerEl.appendChild(btn);
      entry.btn = btn;
    });
  }

  // ---------- debug sampler ----------
  function computeSample() {
    try {
      sampleCtx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
      const n = data.length / 4;
      const ci = (Math.floor(sampleCanvas.height / 2) * sampleCanvas.width + Math.floor(sampleCanvas.width / 2)) * 4;
      const center = (0.2126 * data[ci] + 0.7152 * data[ci + 1] + 0.0722 * data[ci + 2]) / 255;
      let sum = 0, max = 0, nonBlack = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        sum += lum;
        if (lum > max) max = lum;
        if (lum > 0.03) nonBlack++;
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      return {
        avg: sum / n,
        max: max,
        center: center,
        nonBlack: nonBlack / n,
        avgRGB: [r / n / 255, g / n / 255, b / n / 255],
      };
    } catch (err) {
      return { error: String(err) };
    }
  }

  // ---------- boot overlay ----------
  const BOOT_STEPS = [
    'BOOTING WEBGL2 CONTEXT…',
    'COMPILING SHADERS…',
    'ALLOCATING GPU BUFFERS…',
    'CALIBRATING BLOOM & TONEMAP…',
  ];
  const BOOT_MIN_MS = 1250;

  function updateBootUI() {
    if (state.bootDone) return;
    const elapsed = performance.now() - state.bootStart;
    if (!state.ready) {
      const step = Math.min(BOOT_STEPS.length - 1, Math.floor(elapsed / 300));
      bootStatus.textContent = BOOT_STEPS[step];
      bootBar.style.width = Math.min(84, 8 + elapsed / 18) + '%';
    } else {
      bootStatus.textContent = 'LINK ESTABLISHED · 沙盒就绪';
      bootBar.style.width = '100%';
      if (elapsed > BOOT_MIN_MS) finishBoot();
    }
  }

  function finishBoot() {
    if (state.bootDone) return;
    state.bootDone = true;
    bootEl.classList.add('gone');
    setTimeout(function () {
      if (bootEl.parentNode) bootEl.style.display = 'none';
    }, 900);
    NEB.ready = true;
    updatePicker();
  }

  // ---------- frame loop ----------
  function frame(now) {
    requestAnimationFrame(frame);

    const rdt = Math.min(0.1, Math.max(0, (now - state.last) / 1000));
    state.last = now;

    updateBootUI();
    if (!sceneTarget) { return; }

    const dt = state.paused ? 0 : Math.min(0.05, rdt);
    if (!state.paused) state.time += dt;
    const t = state.time;

    // --- fade between scenes ---
    if (state.pendingScene !== null) {
      state.fade += (0 - state.fade) * Math.min(1, rdt * 13);
      if (state.fade < 0.05) {
        const target = state.pendingScene;
        state.pendingScene = null;
        const ok = activate(target);
        if (!ok) toast('场景切换失败，保持当前场景');
        state.fadeTarget = 1;
        state.fade = 0;
      }
    } else {
      state.fade += (state.fadeTarget - state.fade) * Math.min(1, rdt * 5.5);
    }

    // --- pointer smoothing / idle drift ---
    const nowMs = now;
    state.idle = (nowMs - pointer.lastMove) > 3200;
    let tU = pointer.tx, tV = pointer.ty;
    if (state.idle) {
      state.autoT += rdt * 0.22;
      const at = state.autoT;
      tU = 0.5 + Math.sin(at * 0.9) * 0.30 + Math.sin(at * 0.37 + 1.3) * 0.12;
      tV = 0.5 + Math.cos(at * 0.71) * 0.26 + Math.cos(at * 0.23 + 2.1) * 0.10;
    }
    const smoothK = 1 - Math.exp(-rdt * 2.8);
    pointer.u += (tU - pointer.u) * smoothK;
    pointer.v += (tV - pointer.v) * smoothK;
    const prevU = pointer.prevU, prevV = pointer.prevV;
    pointer.prevU = pointer.u; pointer.prevV = pointer.v;

    pointer.pulse *= Math.exp(-rdt * 3.4);
    input.u = pointer.u;
    input.v = pointer.v;
    input.nx = pointer.u * 2 - 1;
    input.ny = pointer.v * 2 - 1;
    input.px = pointer.u * state.targetW;
    input.py = pointer.v * state.targetH;
    input.vx = rdt > 0 ? U.clamp((pointer.u - prevU) / rdt, -5, 5) : 0;
    input.vy = rdt > 0 ? U.clamp((pointer.v - prevV) / rdt, -5, 5) : 0;
    input.down = pointer.down;
    input.pulse = U.clamp(pointer.pulse, 0, 1);
    input.pulseU = pointer.pulseU;
    input.pulseV = pointer.pulseV;
    input.wheel = pointer.wheel;
    input.idle = state.idle;
    const energyTarget = U.clamp(
      Math.hypot(input.vx, input.vy) * 0.55 + input.pulse * 0.65 + audioLevels.level * 0.45,
      0, 1
    );
    input.energy += (energyTarget - input.energy) * (1 - Math.exp(-rdt * 6));

    updateAudioLevels();

    // --- simulate ---
    if (current) {
      try {
        if (!state.paused) current.update(dt, t, input);
      } catch (err) {
        console.error('[STARFALL] update 异常:', err);
      }

      // --- render into HDR target ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fbo);
      gl.viewport(0, 0, sceneTarget.w, sceneTarget.h);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      U.clear(gl, 0, 0, 0, 1);
      try {
        current.render(t);
      } catch (err) {
        console.error('[STARFALL] render 异常:', err);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        U.clear(gl, 0.02, 0, 0.03, 1);
      }

      // --- post ---
      const meta = current.meta;
      if (state.fade > 0.001) {
        try {
          post.render(sceneTarget.tex, {
            sceneW: sceneTarget.w,
            sceneH: sceneTarget.h,
            time: t,
            fade: U.clamp(state.fade, 0, 1),
            bloom: (meta.bloom === undefined ? 1 : meta.bloom) * (1 + audioLevels.bass * 0.45),
            exposure: meta.exposure === undefined ? 1 : meta.exposure,
            threshold: meta.threshold,
            aberration: 0.0014 + input.energy * 0.0012,
            grain: 0.012,
            vignette: 0.62,
            bass: audioLevels.bass,
          });
        } catch (err) {
          console.error('[STARFALL] post 异常:', err);
        }
      }

      // optional GPU sync for benchmarking
      if (window.__NEB_BENCH__) gl.finish();

      // debug pixel stats at end of frame
      if (state.sampleReq) {
        const sample = computeSample();
        const cb = state.sampleReq;
        state.sampleReq = null;
        cb(sample);
      }
    }

    // reset per-frame wheel
    input.wheel = 0;
    pointer.wheel = 0;

    // --- fps / adaptive quality ---
    if (rdt > 0) {
      const inst = 1 / rdt;
      state.fps = state.fps * 0.92 + Math.min(240, inst) * 0.08;
    }
    if (state.adaptive && state.ready && !state.paused) {
      if (state.fps < 47) state.lowTime += rdt;
      else state.lowTime = Math.max(0, state.lowTime - rdt * 0.6);
      if (state.lowTime > 2.5 && state.scale > 0.6) {
        state.scale = Math.max(0.6, state.scale - 0.15);
        state.lowTime = 0;
        resize();
        toast('自适应画质 · RENDER ' + Math.round(state.scale * 100) + '%');
      }
    }

    // --- HUD telemetry (throttled) ---
    state.perfClock += rdt;
    if (state.perfClock > 0.2) {
      state.perfClock = 0;
      fpsEl.textContent = String(Math.round(state.fps));
      scaleEl.textContent = Math.round(state.scale * 100) + '%';
      if (current) detailEl.textContent = sceneDetail();
    }

    // first successful frame
    if (!state.ready && current) state.ready = true;
  }

  // ---------- boot ----------
  if (qs.get('hud') === '0') document.body.classList.add('hide-hud');
  if (qs.get('paused') === '1') setPaused(true);
  collectScenes();
  sizeCanvas();
  sceneTarget = U.target(gl, state.targetW, state.targetH, { filter: gl.LINEAR });
  post = new NEB.Post(gl, state.targetW, state.targetH);
  buildPicker();

  if (!entries.length) {
    showFatal('没有加载到任何场景模块');
  } else {
    let started = false;
    for (let i = 0; i < entries.length; i++) {
      if (activate(i)) { started = true; break; }
    }
    if (!started) {
      showFatal('所有场景初始化失败 · 查看控制台');
    }
  }
  if (scaleEl) scaleEl.textContent = Math.round(state.scale * 100) + '%';

  // ---------- context loss ----------
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    state.lost = true;
    toast('WebGL 上下文丢失 · 正在恢复…');
  }, false);
  canvas.addEventListener('webglcontextrestored', function () {
    location.reload();
  }, false);

  document.addEventListener('visibilitychange', function () {
    state.last = performance.now();
    if (document.hidden) pointer.down = false;
  });

  // ---------- debug API ----------
  window.__NEB_DEBUG = {
    get ready() { return state.ready && state.bootDone; },
    get fps() { return Math.round(state.fps); },
    get sceneId() { return current ? current.meta.id : null; },
    get glError() { return gl.getError(); },
    get renderScale() { return state.scale; },
    get paused() { return state.paused; },
    get audioOn() { return !!(NEB.Audio && NEB.Audio.on); },
    get hudVisible() { return !document.body.classList.contains('hide-hud'); },
    scenes: function () {
      return entries.map(function (e) {
        return { id: e.scene.meta.id, title: e.scene.meta.title, inited: e.inited, failed: e.failed };
      });
    },
    switchScene: function (key) { return switchSceneByKey(key); },
    togglePause: function () { setPaused(!state.paused); return state.paused; },
    toggleAudio: toggleAudio,
    setScale: function (s) {
      state.scale = U.clamp(Number(s) || 1, 0.4, 1);
      resize();
      return state.scale;
    },
    hud: function (show) { document.body.classList.toggle('hide-hud', show === false); },
    sample: function () {
      if (!state.ready) return Promise.resolve({ avg: 0, max: 0, nonBlack: 0, avgRGB: [0, 0, 0] });
      return new Promise(function (resolve) { state.sampleReq = resolve; });
    },
    reseed: function () {
      if (current && typeof current.onReseed === 'function') { current.onReseed(); return true; }
      return false;
    },
  };
  NEB.debug = window.__NEB_DEBUG;

  requestAnimationFrame(function (t) {
    state.last = t;
    frame(t);
  });
})();
