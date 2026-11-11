/* STARFALL · Scene 03 — INK
 * Semi-Lagrangian dye advection through a curl-ish flow field.
 * Coloured ink is continuously injected and stirred by the pointer. */
(function () {
  'use strict';
  const U = window.NEB.util;
  const SIM = 512;
  const SUBSTEPS = 2;

  const ADVECT_FS = `#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uTime;
uniform float uDt;
uniform vec2 uMouse;
uniform float uBrush;
uniform vec2 uM1;
uniform vec2 uM2;
uniform vec2 uM3;
uniform float uInject;
uniform vec2 uPulsePos;
uniform float uPulse;

in vec2 vUv;
out vec4 oColor;

vec2 flow(vec2 p, float t) {
  vec2 v = vec2(0.0);
  v += vec2(sin(p.y * 2.6 + t * 0.23), cos(p.x * 2.3 - t * 0.19)) * 0.42;
  v += vec2(sin(p.y * 5.4 - t * 0.37 + p.x * 1.4), cos(p.x * 4.9 + t * 0.29 - p.y * 1.2)) * 0.20;
  v += vec2(cos(p.y * 9.1 + t * 0.51), sin(p.x * 8.3 - t * 0.43)) * 0.07;
  vec2 d = p - 0.5;
  v += vec2(-d.y, d.x) * 0.55;
  vec2 m = p - uMouse;
  float md = exp(-dot(m, m) * 26.0);
  v += vec2(-m.y, m.x) * md * 2.4;
  v += m * md * 0.7;
  if (uPulse > 0.001) {
    vec2 pd = p - uPulsePos;
    float dl = length(pd) + 1e-4;
    v += (pd / dl) * uPulse * exp(-dot(pd, pd) * 18.0) * 5.0;
  }
  return v;
}

vec3 inject(vec3 col, vec2 p, vec2 center, vec3 ink, float strength) {
  vec2 d = p - center;
  float f = exp(-dot(d, d) * 3800.0) * strength;
  return mix(col, ink, clamp(f, 0.0, 1.0));
}

void main() {
  vec2 uv = vUv;
  vec2 vel = flow(uv, uTime);
  vec2 back = uv - vel * uDt * 0.38;

  // semi-Lagrangian advection with a little diffusion
  vec2 o = uTexel * 1.1;
  vec3 c = texture(uDye, back).rgb * 0.52;
  c += texture(uDye, back + vec2(o.x, 0.0)).rgb * 0.12;
  c += texture(uDye, back - vec2(o.x, 0.0)).rgb * 0.12;
  c += texture(uDye, back + vec2(0.0, o.y)).rgb * 0.12;
  c += texture(uDye, back - vec2(0.0, o.y)).rgb * 0.12;
  c *= 0.9945;

  // continuous moving ink sources
  c = inject(c, uv, uM1, vec3(0.03, 0.95, 0.70), uInject);
  c = inject(c, uv, uM2, vec3(1.05, 0.08, 0.70), uInject);
  c = inject(c, uv, uM3, vec3(1.05, 0.66, 0.20), uInject * 0.9);

  // pointer brush
  if (uBrush > 0.0) {
    vec2 d = uv - uMouse;
    float bf = exp(-dot(d, d) * 2600.0) * uBrush * 1.4;
    c = mix(c, vec3(0.55, 0.95, 1.20), clamp(bf, 0.0, 1.0));
  }

  // click shock ring
  if (uPulse > 0.01) {
    float pd = length(uv - uPulsePos);
    float ring = exp(-pow(pd - (1.0 - uPulse) * 0.55, 2.0) * 500.0) * uPulse;
    c = mix(c, vec3(0.9, 1.10, 1.40), clamp(ring * 0.8, 0.0, 1.0));
  }

  oColor = vec4(min(c, vec3(4.0)), 1.0);
}`;

  const DISPLAY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uTime;
uniform float uBass;
uniform float uPulse;
uniform vec2 uPulsePos;

in vec2 vUv;
out vec4 oColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec3 dyeRaw = texture(uDye, uv).rgb;
  vec3 dye = max(dyeRaw - 0.028, vec3(0.0)) * 1.18;

  // membrane edge highlight
  vec2 o = uTexel * 2.2;
  float br = dot(texture(uDye, uv + vec2(o.x, 0.0)).rgb, vec3(0.33))
           + dot(texture(uDye, uv - vec2(o.x, 0.0)).rgb, vec3(0.33))
           + dot(texture(uDye, uv + vec2(0.0, o.y)).rgb, vec3(0.33))
           + dot(texture(uDye, uv - vec2(0.0, o.y)).rgb, vec3(0.33));
  float lum = dot(dye, vec3(0.33));
  float edge = max(0.0, lum - br * 0.25);

  vec3 col = vec3(0.008, 0.014, 0.026);
  col += dye;
  col += vec3(0.35, 0.85, 1.0) * edge * 0.55;
  col += dye * dye * 0.16;

  // deep ink caustics
  float haze = 0.5 + 0.5 * sin(uv.x * 7.0 + uTime * 0.21) * cos(uv.y * 6.0 - uTime * 0.17);
  col += vec3(0.010, 0.030, 0.042) * haze * (0.5 + uBass * 0.7);

  // subtle scan shimmer through the ink
  float shimmer = pow(0.5 + 0.5 * sin(lum * 55.0 + uTime * 2.6), 16.0);
  col += vec3(0.4, 0.95, 0.8) * shimmer * 0.20;

  // click bloom
  float pd = length(uv - uPulsePos);
  col += vec3(0.6, 1.0, 1.2) * exp(-pd * 9.0) * uPulse * 0.7;

  // vignette
  vec2 d = uv - 0.5;
  col *= 0.30 + 0.70 * (1.0 - smoothstep(0.26, 0.74, length(d)));

  col += (hash12(gl_FragCoord.xy + fract(uTime) * 11.0) - 0.5) * 0.006;

  oColor = vec4(col, 1.0);
}`;

  let gl = null;
  let advectProg = null;
  let dispProg = null;
  let dye = null;
  let w = 1, h = 1;
  let lastTime = 0, lastBass = 0, lastPulse = 0;
  let pulseU = 0.5, pulseV = 0.5;
  let down = 0, mouseU = 0.5, mouseV = 0.5;
  let seed = 20260101;

  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function clearDye() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dye.read.fbo);
    gl.viewport(0, 0, SIM, SIM);
    U.clear(gl, 0, 0, 0, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dye.write.fbo);
    U.clear(gl, 0, 0, 0, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const scene = {
    meta: {
      id: 'fluid', title: 'INK', cn: '墨',
      sub: 'CURL-FLOW DYE · SEMI-LAGRANGIAN',
      accent: '#3dffb5', accent2: '#ffd166', bloom: 1.1,
    },

    init: function (glCtx) {
      gl = glCtx;
      if (!U.hdr.floatRenderable) {
        this.meta.sub = 'FLOAT RENDER TARGETS UNAVAILABLE';
        return;
      }
      advectProg = U.program(gl, U.fullscreenVS, ADVECT_FS);
      dispProg = U.program(gl, U.fullscreenVS, DISPLAY_FRAG);
      dye = U.pingpong(gl, SIM, SIM, {
        internalFormat: gl.RGBA16F,
        type: gl.HALF_FLOAT,
        filter: gl.LINEAR,
      });
      clearDye();
    },

    resize: function (nw, nh) { w = nw; h = nh; },

    update: function (dt, t, input) {
      lastTime = t;
      lastBass = input.audio.bass;
      lastPulse = input.pulse;
      pulseU = input.pulseU;
      pulseV = input.pulseV;
      down = input.down ? 1 : 0;
      mouseU = input.u;
      mouseV = input.v;
      if (!dye || dt <= 0) return;

      const m1x = 0.5 + 0.36 * Math.sin(t * 0.19);
      const m1y = 0.5 + 0.32 * Math.cos(t * 0.23);
      const m2x = 0.5 + 0.38 * Math.cos(t * 0.15 + 2.1);
      const m2y = 0.5 + 0.35 * Math.sin(t * 0.17 + 1.2);
      const m3x = 0.5 + 0.34 * Math.sin(t * 0.12 + 4.3);
      const m3y = 0.5 + 0.36 * Math.cos(t * 0.21 + 3.0);

      for (let i = 0; i < SUBSTEPS; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dye.write.fbo);
        gl.viewport(0, 0, SIM, SIM);
        gl.disable(gl.BLEND);
        gl.useProgram(advectProg);
        U.setTex(gl, 0, dye.read.tex);
        gl.uniform1i(U.loc(gl, advectProg, 'uDye'), 0);
        U.u2f(gl, advectProg, 'uTexel', 1 / SIM, 1 / SIM);
        U.u1f(gl, advectProg, 'uTime', t);
        U.u1f(gl, advectProg, 'uDt', Math.min(dt / SUBSTEPS, 0.05));
        U.u2f(gl, advectProg, 'uMouse', mouseU, mouseV);
        U.u1f(gl, advectProg, 'uBrush', down ? 0.35 : 0.0);
        U.u2f(gl, advectProg, 'uM1', m1x, m1y);
        U.u2f(gl, advectProg, 'uM2', m2x, m2y);
        U.u2f(gl, advectProg, 'uM3', m3x, m3y);
        U.u1f(gl, advectProg, 'uInject', 0.27 + input.energy * 0.10 + lastBass * 0.08);
        U.u2f(gl, advectProg, 'uPulsePos', pulseU, pulseV);
        U.u1f(gl, advectProg, 'uPulse', lastPulse);
        U.quad(gl);
        dye.swap();
      }
    },

    render: function () {
      if (!dye) {
        gl.clearColor(0.01, 0.02, 0.03, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      gl.useProgram(dispProg);
      U.setTex(gl, 0, dye.read.tex);
      gl.uniform1i(U.loc(gl, dispProg, 'uDye'), 0);
      U.u2f(gl, dispProg, 'uTexel', 1 / SIM, 1 / SIM);
      U.u1f(gl, dispProg, 'uTime', lastTime);
      U.u1f(gl, dispProg, 'uBass', lastBass);
      U.u1f(gl, dispProg, 'uPulse', lastPulse);
      U.u2f(gl, dispProg, 'uPulsePos', pulseU, pulseV);
      U.quad(gl);
    },

    onReseed: function () {
      if (dye) clearDye();
    },

    stats: 'CURL FLOW · 512² DYE · 3 INK SOURCES',
  };

  window.NEB.scenes.fluid = scene;
})();
