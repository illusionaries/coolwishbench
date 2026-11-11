#!/usr/bin/env node
/*
 * STARFALL screenshot / diagnostics tool (zero dependencies).
 *
 *   node verify/shot.mjs --url=http://127.0.0.1:5199/ --scene=nebula \
 *     --out=shots/nebula.png --wait=3000 --w=1440 --h=900
 *
 * Launches headless Chrome, waits for __NEB_DEBUG.ready, optionally switches
 * scene / clicks, captures a PNG and prints a JSON report with console errors,
 * FPS and a brightness sample of the rendered frame.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) out[a.slice(2)] = process.argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

const OPT = args();
const URL_ = OPT.url || 'http://127.0.0.1:5199/';
const W = Number(OPT.w || 1440);
const H = Number(OPT.h || 900);
const WAIT = Number(OPT.wait || 2600);
const OUT = OPT.out || path.join('shots', 'shot-' + Date.now() + '.png');
const SCENE = OPT.scene || null;
const CLICK = OPT.click ? String(OPT.click) : null;
const EXTRA_EVAL = OPT.eval || null;
const TIMEOUT = Number(OPT.timeout || 30000);
const KEEP = !!OPT.keep;
const MOBILE = W < 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('CDP websocket open timeout')), 8000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket error')); });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id) {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        } else if (msg.method) {
          const list = this.handlers.get(msg.method);
          if (list) for (const fn of list) { try { fn(msg.params); } catch { /* noop */ } }
        }
      });
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 30000);
    });
  }
  close() { try { this.ws && this.ws.close(); } catch { /* noop */ } }
}

async function launch() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const port = 9300 + Math.floor(Math.random() * 500);
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-chrome-'));
    const child = spawn(CHROME, [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      ...(OPT.novsync ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
      '--window-size=' + W + ',' + H,
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + userDir,
      'about:blank',
    ], { stdio: 'ignore' });

    const deadline = Date.now() + 12000;
    let target = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/json/list');
        const list = await res.json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) break;
      } catch { /* not up yet */ }
      await sleep(150);
    }
    if (target) return { child, port, userDir, target };
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  throw new Error('无法启动 headless Chrome');
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('找不到 Chrome: ' + CHROME);
  const outDir = path.dirname(path.resolve(OUT));
  fs.mkdirSync(outDir, { recursive: true });

  const { child, userDir, target } = await launch();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  const errors = [];
  const warnings = [];
  let exited = false;

  try {
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      errors.push('EXCEPTION: ' + (d.exception && (d.exception.description || d.exception.value) || d.text || 'unknown'));
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'warning') return;
      const text = (p.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      (p.type === 'error' ? errors : warnings).push('console.' + p.type + ': ' + text);
    });
    cdp.on('Log.entryAdded', (p) => {
      const e = p.entry || {};
      if (e.level === 'error') errors.push('LOG: ' + e.text + (e.url ? ' @ ' + e.url : ''));
      else if (e.level === 'warning') warnings.push('LOG: ' + e.text);
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 1, mobile: MOBILE,
    });

    let loadResolve;
    const loadPromise = new Promise((r) => { loadResolve = r; });
    cdp.on('Page.loadEventFired', () => loadResolve(true));

    await cdp.send('Page.navigate', { url: URL_ });
    await Promise.race([loadPromise, sleep(TIMEOUT)]);

    // wait for engine ready
    const readyDeadline = Date.now() + TIMEOUT;
    let ready = false;
    while (Date.now() < readyDeadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: '!!(window.__NEB_DEBUG && window.__NEB_DEBUG.ready)',
        returnByValue: true,
      }).catch(() => null);
      if (r && r.result && r.result.value) { ready = true; break; }
      await sleep(140);
    }

    if (SCENE) {
      await cdp.send('Runtime.evaluate', {
        expression: 'window.__NEB_DEBUG && window.__NEB_DEBUG.switchScene(' + JSON.stringify(SCENE) + ')',
        returnByValue: true,
      }).catch(() => null);
      await sleep(1100);
    }
    if (EXTRA_EVAL) {
      await cdp.send('Runtime.evaluate', { expression: EXTRA_EVAL, returnByValue: true, awaitPromise: true })
        .catch(() => null);
      await sleep(300);
    }
    if (CLICK) {
      const [cx, cy] = CLICK.split(',').map(Number);
      const x = isNaN(cx) ? Math.round(W / 2) : cx;
      const y = isNaN(cy) ? Math.round(H / 2) : cy;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(90);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(250);
    }

    await sleep(WAIT);

    let probe = null;
    if (OPT.probe) {
      const pr = await cdp.send('Runtime.evaluate', {
        expression: `new Promise((resolve) => {
          const ts = [];
          let n = 0;
          function tick(t) {
            ts.push(t);
            if (++n < 45) requestAnimationFrame(tick);
            else {
              const ds = ts.slice(1).map((v, i) => v - ts[i]);
              ds.sort((a, b) => a - b);
              resolve({
                frameMsAvg: +(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2),
                frameMsMin: +ds[0].toFixed(2),
                frameMsP50: +ds[Math.floor(ds.length / 2)].toFixed(2),
                frameMsMax: +ds[ds.length - 1].toFixed(2),
                fps: +(1000 / (ds.reduce((a, b) => a + b, 0) / ds.length)).toFixed(1),
              });
            }
          }
          requestAnimationFrame(tick);
        })`,
        awaitPromise: true, returnByValue: true,
      }).catch(() => null);
      if (pr && pr.result && pr.result.value) probe = pr.result.value;
    }

    let diag = {};
    const diagRes = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const d = window.__NEB_DEBUG || {};
        return {
          ready: !!d.ready, fps: d.fps, sceneId: d.sceneId, glError: d.glError,
          renderScale: d.renderScale, paused: d.paused, audioOn: d.audioOn,
          scenes: d.scenes ? d.scenes() : null,
          renderer: (() => {
            try {
              const c = document.getElementById('gl');
              const g = c && c.getContext('webgl2');
              if (!g) return null;
              const ext = g.getExtension('WEBGL_debug_renderer_info');
              return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
            } catch (e) { return null; }
          })(),
          title: document.title,
          canvas: (() => { const c = document.getElementById('gl'); return c ? [c.width, c.height] : null; })(),
        };
      })()`,
      returnByValue: true,
    }).catch(() => null);
    if (diagRes && diagRes.result && diagRes.result.value) diag = diagRes.result.value;

    let sample = null;
    const sampleRes = await cdp.send('Runtime.evaluate', {
      expression: 'window.__NEB_DEBUG && window.__NEB_DEBUG.sample()',
      awaitPromise: true, returnByValue: true,
    }).catch(() => null);
    if (sampleRes && sampleRes.result && sampleRes.result.value) sample = sampleRes.result.value;

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.resolve(OUT), Buffer.from(shot.data, 'base64'));

    let audioCheck = null;
    if (OPT.audio) {
      const ar = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          if (!window.__NEB_DEBUG) return 'no debug';
          const on = await window.__NEB_DEBUG.toggleAudio();
          await new Promise(r => setTimeout(r, 700));
          const s = window.NEB && window.NEB.Audio ? window.NEB.Audio.sample() : null;
          return { on: on, sample: s };
        })()`,
        awaitPromise: true, returnByValue: true,
      }).catch(() => null);
      if (ar && ar.result) audioCheck = ar.result.value;
    }

    const report = {
      ok: ready && errors.length === 0,
      url: URL_,
      out: path.resolve(OUT),
      ready,
      scene: diag.sceneId || null,
      fps: diag.fps === undefined ? null : diag.fps,
      renderScale: diag.renderScale === undefined ? null : diag.renderScale,
      glError: diag.glError === undefined ? null : diag.glError,
      canvas: diag.canvas || null,
      renderer: diag.renderer || null,
      probe,
      sample,
      audio: audioCheck,
      errors,
      warnings: warnings.slice(0, 20),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    cdp.close();
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    await sleep(250);
    if (!KEEP) { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* noop */ } }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.stack || err) }, null, 2));
  process.exit(2);
});
