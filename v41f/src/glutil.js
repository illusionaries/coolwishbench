/* STARFALL · WebGL2 utilities — no dependencies, classic script */
(function () {
  'use strict';

  const NEB = (window.NEB = window.NEB || {});
  NEB.scenes = NEB.scenes || {};

  const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const U = {
    gl: null,
    fullscreenVS: FULLSCREEN_VS,
    hdr: null,
    emptyVAO: null,
  };

  U.init = function (gl) {
    U.gl = gl;
    U.emptyVAO = gl.createVertexArray();

    const floatRT = !!gl.getExtension('EXT_color_buffer_float');
    U.hdr = floatRT
      ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, floatRenderable: true }
      : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, floatRenderable: false };

    // Linear filtering of half-float textures is core in WebGL2.
    U.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    return U;
  };

  U.compile = function (gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const kind = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
      gl.deleteShader(sh);
      const numbered = src.split('\n').map((l, i) => String(i + 1).padStart(3, ' ') + ' | ' + l).join('\n');
      throw new Error(kind + ' shader compile failed:\n' + log + '\n---\n' + numbered);
    }
    return sh;
  };

  U.program = function (gl, vsSrc, fsSrc) {
    const vs = U.compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = U.compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('Program link failed:\n' + log);
    }
    prog.__uniforms = new Map();
    return prog;
  };

  U.loc = function (gl, prog, name) {
    if (!prog.__uniforms) prog.__uniforms = new Map();
    const cache = prog.__uniforms;
    if (cache.has(name)) return cache.get(name);
    const loc = gl.getUniformLocation(prog, name);
    cache.set(name, loc);
    return loc;
  };

  U.u1f = function (gl, p, n, x) { gl.uniform1f(U.loc(gl, p, n), x); };
  U.u1i = function (gl, p, n, x) { gl.uniform1i(U.loc(gl, p, n), x); };
  U.u2f = function (gl, p, n, x, y) { gl.uniform2f(U.loc(gl, p, n), x, y); };
  U.u3f = function (gl, p, n, x, y, z) { gl.uniform3f(U.loc(gl, p, n), x, y, z); };
  U.u4f = function (gl, p, n, x, y, z, w) { gl.uniform4f(U.loc(gl, p, n), x, y, z, w); };
  U.uMat4 = function (gl, p, n, m) { gl.uniformMatrix4fv(U.loc(gl, p, n), false, m); };

  U.tex = function (gl, w, h, opts) {
    const o = opts || {};
    const internalFormat = o.internalFormat || U.hdr.internalFormat;
    const format = o.format || gl.RGBA;
    const type = o.type || U.hdr.type;
    const filter = o.filter === undefined ? gl.LINEAR : o.filter;
    const wrap = o.wrap === undefined ? gl.CLAMP_TO_EDGE : o.wrap;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, o.data || null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    tex.__w = w;
    tex.__h = h;
    return tex;
  };

  U.fbo = function (gl, tex) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      throw new Error('Incomplete framebuffer (status 0x' + status.toString(16) + ')');
    }
    return fbo;
  };

  U.target = function (gl, w, h, opts) {
    const tex = U.tex(gl, w, h, opts);
    const fbo = U.fbo(gl, tex);
    return {
      tex: tex, fbo: fbo, w: w, h: h,
      resize: function (nw, nh) {
        if (nw === this.w && nh === this.h) return;
        gl.deleteFramebuffer(this.fbo);
        gl.deleteTexture(this.tex);
        this.tex = U.tex(gl, nw, nh, opts);
        this.fbo = U.fbo(gl, this.tex);
        this.w = nw; this.h = nh;
      },
      dispose: function () {
        gl.deleteFramebuffer(this.fbo);
        gl.deleteTexture(this.tex);
      },
    };
  };

  U.pingpong = function (gl, w, h, opts) {
    const pp = {
      w: w, h: h, read: null, write: null,
      swap: function () {
        const t = pp.read; pp.read = pp.write; pp.write = t;
      },
      resize: function (nw, nh) {
        if (nw === pp.w && nh === pp.h) return;
        pp.w = nw; pp.h = nh;
        pp.read.resize(nw, nh);
        pp.write.resize(nw, nh);
      },
      dispose: function () {
        pp.read.dispose();
        pp.write.dispose();
      },
    };
    pp.read = U.target(gl, w, h, opts);
    pp.write = U.target(gl, w, h, opts);
    return pp;
  };

  U.setTex = function (gl, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };

  U.quad = function (gl) {
    gl.bindVertexArray(U.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  U.clear = function (gl, r, g, b, a) {
    gl.clearColor(r || 0, g || 0, b || 0, a === undefined ? 1 : a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  U.smoothstep = function (e0, e1, x) {
    const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.now = function () { return performance.now() / 1000; };

  NEB.util = U;
})();
