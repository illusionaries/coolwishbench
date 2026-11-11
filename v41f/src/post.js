/* STARFALL · HDR post-processing: bright pass -> downsample chain -> additive upsample -> ACES composite */
(function () {
  'use strict';
  const NEB = (window.NEB = window.NEB || {});
  const U = NEB.util;

  const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, br - uThreshold) / max(br, 1e-5);
  oColor = vec4(c * w, 1.0);
}`;

  const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uTex, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture(uTex, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture(uTex, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture(uTex, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uTex, vUv).rgb;
  vec3 f = texture(uTex, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uTex, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(uTex, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture(uTex, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture(uTex, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture(uTex, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture(uTex, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(uTex, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 r = e * 0.125
    + (a + c + g + i) * 0.03125
    + (b + d + f + h) * 0.0625
    + (j + k + l + m) * 0.125;
  oColor = vec4(r, 1.0);
}`;

  const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += (texture(uTex, vUv + vec2(-t.x, 0.0)).rgb + texture(uTex, vUv + vec2(t.x, 0.0)).rgb
      + texture(uTex, vUv + vec2(0.0, -t.y)).rgb + texture(uTex, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(uTex, vUv + vec2(-t.x, -t.y)).rgb + texture(uTex, vUv + vec2(t.x, -t.y)).rgb
     + texture(uTex, vUv + vec2(-t.x, t.y)).rgb + texture(uTex, vUv + vec2(t.x, t.y)).rgb;
  oColor = vec4(s / 16.0, 1.0);
}`;

  const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uFade;
uniform float uAberration;
uniform float uGrain;
uniform float uVignette;
uniform float uBass;
in vec2 vUv;
out vec4 oColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);

  // chromatic aberration grows toward the frame edge, pulses with bass
  vec2 ca = d * (uAberration + uBass * 0.0022) * (0.25 + r2 * 2.2);
  vec3 col;
  col.r = texture(uScene, uv + ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - ca).b;

  // HDR bloom
  vec3 bloom = texture(uBloom, uv).rgb;
  col += bloom * uBloomStrength;

  // exposure + filmic tonemap
  col *= uExposure;
  col = aces(col);

  // vignette
  float v = 1.0 - smoothstep(0.25, 0.92, length(d) * 1.35);
  col *= mix(1.0, v, uVignette);

  // film grain
  float g = hash12(gl_FragCoord.xy + fract(uTime) * 137.0);
  col += (g - 0.5) * uGrain;

  // linear -> sRGB-ish display
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));

  col *= uFade;
  oColor = vec4(col, 1.0);
}`;

  const LEVELS = 4;

  function Post(gl, w, h) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.sceneW = w;
    this.sceneH = h;
    this.levels = [];
    this.brightProg = U.program(gl, U.fullscreenVS, BRIGHT_FS);
    this.downProg = U.program(gl, U.fullscreenVS, DOWN_FS);
    this.upProg = U.program(gl, U.fullscreenVS, UP_FS);
    this.compProg = U.program(gl, U.fullscreenVS, COMPOSITE_FS);
    this.resize(w, h);
  }

  Post.prototype._disposeLevels = function () {
    for (let i = 0; i < this.levels.length; i++) this.levels[i].dispose();
    this.levels.length = 0;
  };

  Post.prototype.resize = function (w, h) {
    const gl = this.gl;
    this._disposeLevels();
    this.w = Math.max(2, Math.floor(w));
    this.h = Math.max(2, Math.floor(h));
    let lw = Math.max(1, Math.floor(this.w / 2));
    let lh = Math.max(1, Math.floor(this.h / 2));
    for (let i = 0; i < LEVELS; i++) {
      this.levels.push(U.target(gl, Math.max(1, lw >> i), Math.max(1, lh >> i), {
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
      }));
    }
  };

  // sceneTex: HDR texture; params: { sceneW, sceneH, time, fade, bloom, exposure,
  //   threshold, knee, aberration, grain, vignette, bass }
  Post.prototype.render = function (sceneTex, params) {
    const gl = this.gl;
    const p = params || {};
    const fade = p.fade === undefined ? 1 : p.fade;
    const bloom = p.bloom === undefined ? 1.0 : p.bloom;
    const exposure = p.exposure === undefined ? 1.0 : p.exposure;
    const threshold = p.threshold === undefined ? (U.hdr.floatRenderable ? 0.9 : 0.72) : p.threshold;
    const knee = p.knee === undefined ? 0.5 : p.knee;
    const aberration = p.aberration === undefined ? 0.0016 : p.aberration;
    const grain = p.grain === undefined ? 0.012 : p.grain;
    const vignette = p.vignette === undefined ? 0.55 : p.vignette;
    const bass = p.bass || 0;
    const time = p.time || 0;
    const sceneW = p.sceneW || this.sceneW;
    const sceneH = p.sceneH || this.sceneH;
    this.sceneW = sceneW;
    this.sceneH = sceneH;

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // 1. bright pass -> level 0
    const l0 = this.levels[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, l0.fbo);
    gl.viewport(0, 0, l0.w, l0.h);
    gl.useProgram(this.brightProg);
    U.setTex(gl, 0, sceneTex);
    gl.uniform1i(U.loc(gl, this.brightProg, 'uTex'), 0);
    U.u2f(gl, this.brightProg, 'uTexel', 1 / sceneW, 1 / sceneH);
    U.u1f(gl, this.brightProg, 'uThreshold', threshold);
    U.u1f(gl, this.brightProg, 'uKnee', knee);
    U.quad(gl);

    // 2. downsample chain
    gl.useProgram(this.downProg);
    for (let i = 1; i < LEVELS; i++) {
      const src = this.levels[i - 1];
      const dst = this.levels[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      U.setTex(gl, 0, src.tex);
      gl.uniform1i(U.loc(gl, this.downProg, 'uTex'), 0);
      U.u2f(gl, this.downProg, 'uTexel', 1 / src.w, 1 / src.h);
      U.quad(gl);
    }

    // 3. additive upsample chain
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.upProg);
    for (let i = LEVELS - 1; i > 0; i--) {
      const src = this.levels[i];
      const dst = this.levels[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      U.setTex(gl, 0, src.tex);
      gl.uniform1i(U.loc(gl, this.upProg, 'uTex'), 0);
      U.u2f(gl, this.upProg, 'uTexel', 1 / src.w, 1 / src.h);
      U.u1f(gl, this.upProg, 'uRadius', 1.0);
      U.quad(gl);
    }
    gl.disable(gl.BLEND);

    // 4. composite to canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.compProg);
    U.setTex(gl, 0, sceneTex);
    U.setTex(gl, 1, this.levels[0].tex);
    gl.uniform1i(U.loc(gl, this.compProg, 'uScene'), 0);
    gl.uniform1i(U.loc(gl, this.compProg, 'uBloom'), 1);
    U.u2f(gl, this.compProg, 'uResolution', gl.drawingBufferWidth, gl.drawingBufferHeight);
    U.u1f(gl, this.compProg, 'uTime', time);
    U.u1f(gl, this.compProg, 'uExposure', exposure);
    U.u1f(gl, this.compProg, 'uBloomStrength', bloom);
    U.u1f(gl, this.compProg, 'uFade', fade);
    U.u1f(gl, this.compProg, 'uAberration', aberration);
    U.u1f(gl, this.compProg, 'uGrain', grain);
    U.u1f(gl, this.compProg, 'uVignette', vignette);
    U.u1f(gl, this.compProg, 'uBass', bass);
    U.quad(gl);
  };

  Post.prototype.dispose = function () {
    this._disposeLevels();
    const gl = this.gl;
    [this.brightProg, this.downProg, this.upProg, this.compProg].forEach(function (p) { gl.deleteProgram(p); });
  };

  NEB.Post = Post;
})();
