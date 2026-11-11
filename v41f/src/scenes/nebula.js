/* STARFALL · Scene 01 — NEBULA
 * 262,144 GPU particles (512x512 state texture) driven by curl noise,
 * pointer vortices and audio-reactive forces. Additive HDR points. */
(function () {
  'use strict';
  const U = window.NEB.util;
  const SIM = 512;
  const COUNT = SIM * SIM;

  const STATE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform float uTime;
uniform float uDt;
uniform vec2 uAspect;
uniform vec2 uPointer;
uniform vec2 uPulsePos;
uniform float uPulse;
uniform float uBass;
uniform float uEnergy;

out vec4 oState;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec2 curl(vec3 p) {
  const float e = 0.14;
  float n1 = snoise(p + vec3(0.0, e, 0.0));
  float n2 = snoise(p - vec3(0.0, e, 0.0));
  float n3 = snoise(p + vec3(e, 0.0, 0.0));
  float n4 = snoise(p - vec3(e, 0.0, 0.0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 st = texelFetch(uState, ip, 0);
  vec2 p = st.xy;
  vec2 vel = st.zw;

  float r = length(p) + 1e-4;
  vec2 tang = vec2(-p.y, p.x) / r;

  // differential rotation: the inner disk spins faster
  float orbit = 0.26 / (0.30 + r * 1.15);
  vec2 target = tang * orbit;

  // curl-noise turbulence (two octaves)
  vec3 np = vec3(p * 2.35, uTime * 0.10);
  target += curl(np) * 0.22;
  target += curl(np * 2.9 + vec3(7.3, 1.9, uTime * 0.06)) * 0.10;

  // pointer stir: swirl + gentle push
  vec2 pd = p - uPointer;
  float pd2 = dot(pd, pd);
  float pin = exp(-pd2 * 3.2);
  vec2 pdN = pd / (sqrt(pd2) + 0.08);
  target += vec2(-pdN.y, pdN.x) * pin * 1.15;
  target += pdN * pin * 0.32;

  // click shockwave
  if (uPulse > 0.001) {
    target += pdN * uPulse * exp(-pd2 * 3.5) * 7.5;
  }

  // audio breathing
  target *= 1.0 + uBass * 0.9 + uEnergy * 0.25;

  vel += (target - vel) * clamp(uDt * 2.2, 0.0, 1.0);
  vel *= exp(-uDt * 0.45);
  p += vel * uDt;

  // strays respawn back into the nebula disk
  if (abs(p.x) > 1.12 || abs(p.y) > 1.12) {
    float h1 = hash21(vec2(gl_FragCoord.x, gl_FragCoord.y));
    float h2 = hash21(vec2(h1, 3.17));
    float ang = h2 * 6.2831853;
    float rad = pow(hash21(vec2(gl_FragCoord.y, h1)), 0.7) * 0.95;
    p = vec2(cos(ang) * rad, sin(ang) * rad);
    vel = vec2(-sin(ang), cos(ang)) * 0.06;
  }

oState = vec4(p, vel);
}`;

  const BG_FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uAspect;
uniform float uBass;
in vec2 vUv;
out vec4 oColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect.x, 1.0) * 2.0;
  float r = length(p);
  vec3 col = vec3(0.004, 0.009, 0.022);
  float t = uTime * 0.03;

  vec2 q = p * 1.35 + vec2(t * 0.7, -t * 0.4);
  float n1 = fbm(q + vec2(sin(t), cos(t)) * 0.35);
  float n2 = fbm(q * 1.9 - 3.2 + vec2(cos(t * 1.3), sin(t * 1.1)) * 0.4);
  col += vec3(0.05, 0.13, 0.34) * smoothstep(0.36, 0.92, n1) * 0.85;
  col += vec3(0.24, 0.05, 0.32) * smoothstep(0.42, 0.95, n2) * 0.7;
  col += vec3(0.05, 0.24, 0.36) * smoothstep(0.52, 0.98, fbm(q * 3.1 + 7.0)) * 0.55;
  col += vec3(0.14, 0.34, 0.66) * exp(-r * 2.4) * (0.26 + uBass * 0.55);
  // hot nebula heart
  col += vec3(0.42, 0.62, 1.10) * exp(-r * 5.2) * 0.22;
  col += vec3(1.20, 0.78, 1.35) * exp(-r * 19.0) * 0.55;

  // star field
  vec2 gp = vUv * vec2(uAspect.x, 1.0) * 300.0;
  vec2 cell = floor(gp);
  vec2 f = fract(gp) - 0.5;
  float h = hash21(cell);
  float twinkle = 0.55 + 0.45 * sin(uTime * 2.3 + h * 42.0);
  float star = step(0.976, h) * exp(-dot(f, f) * 26.0) * twinkle;
  col += vec3(0.72, 0.86, 1.0) * star * 1.9;
  float h2 = hash21(cell + 17.0);
  float star2 = step(0.993, h2) * exp(-dot(f, f) * 46.0) * (0.7 + 0.3 * sin(uTime * 1.7 + h2 * 61.0));
  col += vec3(0.9, 0.75, 1.0) * star2 * 3.2;

  // deep vignette so particles pop
  col *= 0.35 + 0.65 * (1.0 - smoothstep(0.15, 1.35, r));
  oColor = vec4(col, 1.0);
}`;

  const POINTS_VS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uStateSize;
uniform float uTime;
uniform float uBass;
uniform float uEnergy;
uniform float uPixelRatio;
out vec3 vColor;
out float vBright;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

void main() {
  int id = gl_VertexID;
  int w = int(uStateSize.x);
  ivec2 coord = ivec2(id % w, id / w);
  vec4 st = texelFetch(uState, coord, 0);
  vec2 p = st.xy;
  vec2 vel = st.zw;
  float speed = length(vel);
  float r = length(p);

  gl_Position = vec4(p, 0.0, 1.0);

  float h = hash11(float(id));
  float star = step(0.984 - 0.018 * exp(-r * 4.0), h);
  float size = (1.10 + speed * 3.6) * uPixelRatio * (0.9 + uBass * 0.35);
  size *= mix(1.0, 2.7, star);
  gl_PointSize = clamp(size, 1.0, 7.0);

  vec3 cCyan = vec3(0.20, 0.66, 1.10);
  vec3 cPink = vec3(1.05, 0.24, 0.82);
  vec3 cGold = vec3(1.20, 0.86, 0.48);
  vec3 cWhite = vec3(1.10, 1.20, 1.35);

  float mixv = 0.5 + 0.5 * sin(atan(p.y, p.x) * 1.7 + uTime * 0.22 + r * 3.1);
  vec3 dust = mix(cCyan, cPink, mixv * 0.9);
  dust = mix(dust, cGold, smoothstep(0.45, 1.05, speed) * 0.55);

  vec3 starCol = mix(cWhite, mix(cGold, cPink, h * 1.6), 0.55);
  vec3 col = mix(dust, starCol, star);
  col *= 0.45 + 0.75 * (1.0 - smoothstep(0.1, 1.15, r));

  vColor = col;
  float dustBright = 0.055 + speed * 0.55 + uBass * 0.12 + uEnergy * 0.08;
  vBright = mix(dustBright, 1.65 + speed * 3.4, star);
}`;

  const POINTS_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vBright;
out vec4 oColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 4.2) * (1.0 - smoothstep(0.7, 1.0, r2));
  oColor = vec4(vColor * a * vBright, 1.0);
}`;

  let gl = null;
  let sim = null;
  let stateProg = null;
  let bgProg = null;
  let pointProg = null;
  let pointsVAO = null;
  let w = 1, h = 1;
  let aspectX = 1;
  let pixelRatio = 1;
  let time = 0;
  let lastBass = 0;
  let lastEnergy = 0;
  const seedData = new Float32Array(COUNT * 4);

  function seed(glCtx) {
    const ax = aspectX;
    for (let i = 0; i < COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.pow(Math.random(), 0.68) * 0.95;
      const x = Math.cos(ang) * rad * ax;
      const y = Math.sin(ang) * rad;
      const tangential = (Math.random() < 0.75 ? 1 : -1) * (0.05 + Math.random() * 0.16);
      const vx = -Math.sin(ang) * tangential;
      const vy = Math.cos(ang) * tangential;
      const o = i * 4;
      seedData[o] = x;
      seedData[o + 1] = y;
      seedData[o + 2] = vx;
      seedData[o + 3] = vy;
    }
    [sim.read, sim.write].forEach(function (target) {
      glCtx.bindTexture(glCtx.TEXTURE_2D, target.tex);
      glCtx.texSubImage2D(glCtx.TEXTURE_2D, 0, 0, 0, SIM, SIM, glCtx.RGBA, glCtx.FLOAT, seedData);
    });
    glCtx.bindTexture(glCtx.TEXTURE_2D, null);
  }

  const scene = {
    meta: {
      id: 'nebula', title: 'NEBULA', cn: '星云',
      sub: '262,144 PARTICLES · CURL NOISE',
      accent: '#7df9ff', accent2: '#c77dff', bloom: 0.95,
    },

    init: function (glCtx, initW, initH) {
      gl = glCtx;
      w = initW; h = initH;
      aspectX = w / Math.max(1, h);
      pixelRatio = w / Math.max(1, window.innerWidth);

      if (!U.hdr.floatRenderable) {
        // graceful HQ-less fallback: reuse a cheap procedural nebula
        this.meta.sub = 'FLOAT RENDER TARGETS UNAVAILABLE';
        bgProg = U.program(gl, U.fullscreenVS, BG_FRAG);
        sim = null;
        return;
      }

      stateProg = U.program(gl, U.fullscreenVS, STATE_FRAG);
      bgProg = U.program(gl, U.fullscreenVS, BG_FRAG);
      pointProg = U.program(gl, POINTS_VS, POINTS_FS);
      pointsVAO = gl.createVertexArray();

      sim = U.pingpong(gl, SIM, SIM, {
        internalFormat: gl.RGBA32F,
        type: gl.FLOAT,
        filter: gl.NEAREST,
      });
      seed(gl);
    },

    resize: function (nw, nh) {
      w = nw; h = nh;
      aspectX = w / Math.max(1, h);
      pixelRatio = U.clamp(w / Math.max(1, window.innerWidth), 0.4, 3);
    },

    update: function (dt, t, input) {
      time = t;
      lastBass = input.audio.bass;
      lastEnergy = input.energy;
      if (!sim || dt <= 0) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sim.write.fbo);
      gl.viewport(0, 0, SIM, SIM);
      gl.disable(gl.BLEND);
      gl.useProgram(stateProg);
      U.setTex(gl, 0, sim.read.tex);
      gl.uniform1i(U.loc(gl, stateProg, 'uState'), 0);
      U.u1f(gl, stateProg, 'uTime', t);
      U.u1f(gl, stateProg, 'uDt', Math.min(dt, 0.05));
          U.u2f(gl, stateProg, 'uPointer', input.nx, input.ny);
      U.u2f(gl, stateProg, 'uPulsePos', input.pulseU * 2 - 1, input.pulseV * 2 - 1);
      U.u1f(gl, stateProg, 'uPulse', input.pulse);
      U.u1f(gl, stateProg, 'uBass', input.audio.bass);
      U.u1f(gl, stateProg, 'uEnergy', input.energy);
      U.quad(gl);
      sim.swap();
    },

    render: function (t) {
      gl.useProgram(bgProg);
      U.u1f(gl, bgProg, 'uTime', t);
      U.u2f(gl, bgProg, 'uAspect', aspectX, 1);
      U.u1f(gl, bgProg, 'uBass', lastBass);
      U.quad(gl);

      if (!sim) return;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pointProg);
      U.setTex(gl, 0, sim.read.tex);
      gl.uniform1i(U.loc(gl, pointProg, 'uState'), 0);
      U.u2f(gl, pointProg, 'uStateSize', SIM, SIM);
      U.u1f(gl, pointProg, 'uTime', t);
      U.u1f(gl, pointProg, 'uBass', lastBass);
      U.u1f(gl, pointProg, 'uEnergy', lastEnergy);
      U.u1f(gl, pointProg, 'uPixelRatio', pixelRatio);
      gl.bindVertexArray(pointsVAO);
      gl.drawArrays(gl.POINTS, 0, COUNT);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },

    onReseed: function () {
      if (sim) seed(gl);
    },

    stats: '262,144 PARTICLES · 512² STATE',
  };

  window.NEB.scenes.nebula = scene;
})();
