/* STARFALL · Scene 02 — WARP
 * Raymarched kaleidoscopic warp tunnel: twisted 8-fold neon rings inside a
 * glowing tube, with volumetric edge glow and a hot vanishing point. */
(function () {
  'use strict';
  const U = window.NEB.util;

  const FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uPulse;
uniform float uEnergy;
uniform vec2 uPointer;
uniform float uBoost;
uniform vec2 uPulsePos;

out vec4 oColor;

const float TAU = 6.28318530718;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 palette(float t) {
  t = fract(t);
  vec3 c1 = vec3(0.06, 0.58, 1.05);
  vec3 c2 = vec3(1.05, 0.12, 0.78);
  vec3 c3 = vec3(1.15, 0.68, 0.26);
  vec3 c = mix(c1, c2, smoothstep(0.0, 0.48, t));
  c = mix(c, c3, smoothstep(0.52, 1.0, t));
  return c;
}

float map(vec3 p) {
  float tw = p.z * 0.32 + uTime * 0.45;
  vec2 q = rot(tw) * p.xy;
  float r = length(q);
  float a = atan(q.y, q.x);
  float seg = TAU / 8.0;
  float af = abs(mod(a, seg) - seg * 0.5);

  // wall radius: 8-fold corrugation + slow breathing
  float R = 1.34 + 0.085 * sin(af * 8.0 + p.z * 1.1 + uTime * 0.8) + 0.02 * sin(p.z * 3.0 + uTime);

  float wall = abs(r - R) - 0.045;

  // flying neon tori
  float zz = mod(p.z + uTime * 2.0, 2.15) - 1.075;
  float ring = length(vec2(r - R, zz)) - 0.065;

  // small floating shards near the axis
  vec3 sp = p;
  sp.z = mod(sp.z + uTime * 1.2, 3.0) - 1.5;
  float shard = length(sp.xy * rot(-sp.z * 1.5)) - 0.055;

  return min(min(wall, ring), shard + 0.42);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r0 = length(uv);

  // camera: roll + tilt follows the pointer
  uv = rot(uPointer.x * 0.18) * uv;
  vec3 rd = normalize(vec3(uv * 1.32, 1.0));
  rd.xz = rot(uPointer.x * 0.20) * rd.xz;
  rd.yz = rot(-uPointer.y * 0.20) * rd.yz;
  vec3 ro = vec3(0.0);

  float speed = 1.0 + uBass * 1.4 + uBoost * 1.8 + uPulse * 2.5;

  float t = 0.06;
  float glow = 0.0;
  vec3 p = ro;
  bool hit = false;

  for (int i = 0; i < 76; i++) {
    p = ro + rd * t;
    float d = map(p);
    glow += exp(-abs(d) * 12.0) * exp(-t * 0.26) * 0.0045;
    if (d < 0.0018) { hit = true; break; }
    t += d * 0.85;
    if (t > 22.0) break;
  }

  vec3 col = vec3(0.004, 0.003, 0.012);
  float ang = atan(p.y, p.x);
  vec3 pal = palette(t * 0.055 + ang * 0.055 + uTime * 0.035 + r0 * 0.10);

  col += pal * glow * (1.1 + uBass * 1.6 + uBoost * 0.8);

  if (hit) {
    float e = 0.0025;
    vec3 n = normalize(vec3(
      map(p + vec3(e, 0.0, 0.0)) - map(p - vec3(e, 0.0, 0.0)),
      map(p + vec3(0.0, e, 0.0)) - map(p - vec3(0.0, e, 0.0)),
      map(p + vec3(0.0, 0.0, e)) - map(p - vec3(0.0, 0.0, e))
    ));
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);

    float ringPlane = abs(mod(p.z + uTime * 2.0, 2.15) - 1.075);
    float ringGlow = exp(-ringPlane * 30.0);
    float ringPhase = fract((p.z + uTime * 2.0) / 2.15);
    vec3 ringCol = palette(ringPhase * 0.9 + ang * 0.07 + uTime * 0.03);

    vec3 pal = palette(t * 0.022 + ang * 0.03 + uTime * 0.02);
    vec3 surf = pal * (0.018 + fres * 0.10);
    surf += ringCol * ringGlow * (0.30 + ringGlow * 1.9);
    surf += vec3(0.55, 0.72, 1.0) * fres * fres * 0.16;

    col += surf * exp(-t * 0.045);
  }

  // expanding shockwave ring on click
  float pd = length(uv - uPulsePos);
  float shock = exp(-pow((pd - (1.0 - uPulse) * 0.95) * 8.0, 2.0)) * uPulse;
  col += palette(uTime * 0.08 + 0.3) * shock * 1.3;

  // hot core at the end of the tunnel
  float core = exp(-r0 * 6.5);
  col += palette(uTime * 0.05 + 0.55) * core * (0.30 + uBass * 0.45 + uBoost * 0.55 + uPulse * 0.7);

  // warped stained glass at the tunnel mouth
  float glass = pow(0.5 + 0.5 * cos(atan(uv.y, uv.x) * 8.0 + uTime * 0.3), 18.0);
  col += palette(0.15 + uTime * 0.02) * glass * exp(-r0 * 2.6) * 0.05;

  // deep frame vignette
  col *= 0.28 + 0.72 * (1.0 - smoothstep(0.22, 1.12, r0));

  // grain-ish dither to kill banding
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 17.0) - 0.5) * 0.006;

  oColor = vec4(col, 1.0);
}`;

  let gl = null;
  let prog = null;
  let w = 1, h = 1;
  let boost = 0;
  let lastBass = 0, lastPulse = 0, lastEnergy = 0, lastTime = 0;
  let px = 0, py = 0;
  let pulseU = 0.5, pulseV = 0.5;

  const scene = {
    meta: {
      id: 'tunnel', title: 'WARP', cn: '曲速',
      sub: 'RAYMARCHED NEON SDF · 8-FOLD',
      accent: '#ffb657', accent2: '#ff4fd8', bloom: 0.9,
    },

    init: function (glCtx) {
      gl = glCtx;
      prog = U.program(gl, U.fullscreenVS, FRAG);
    },

    resize: function (nw, nh) { w = nw; h = nh; },

    update: function (dt, t, input) {
      lastTime = t;
      lastBass = input.audio.bass;
      lastPulse = input.pulse;
      lastEnergy = input.energy;
      px = input.nx;
      py = input.ny;
      pulseU = input.pulseU * 2 - 1;
      pulseV = input.pulseV * 2 - 1;
      if (input.wheel) boost = Math.min(1, boost + Math.abs(input.wheel) * 0.004);
      boost *= Math.exp(-Math.max(0, dt) * 1.2);
      if (input.pulse > 0.6) boost = Math.min(1, boost + 0.3);
    },

    render: function () {
      gl.useProgram(prog);
      U.u2f(gl, prog, 'uRes', w, h);
      U.u1f(gl, prog, 'uTime', lastTime);
      U.u1f(gl, prog, 'uBass', lastBass);
      U.u1f(gl, prog, 'uPulse', lastPulse);
      U.u1f(gl, prog, 'uEnergy', lastEnergy);
      U.u2f(gl, prog, 'uPointer', px, py);
      U.u1f(gl, prog, 'uBoost', boost);
      U.u2f(gl, prog, 'uPulsePos', pulseU, pulseV);
      U.quad(gl);
    },

    onReseed: function () { lastTime += 137.0; },

    stats: '76-STEP SDF · 8-FOLD NEON RINGS',
  };

  window.NEB.scenes.tunnel = scene;
})();
