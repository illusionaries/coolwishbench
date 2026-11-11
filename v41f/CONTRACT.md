# STARFALL · 星坠 — 开发契约

一个零依赖、零构建的实时生成式视觉引擎：WebGL2 + HDR 泛光 + 程序化环境音。
打开 `index.html` 即可运行（经典脚本，可 `file://` 直开），或 `node serve.mjs` 后访问 `http://127.0.0.1:5199`。

**核心原则：电影感、暗场、霓虹、高动态范围（HDR 亮度 > 1 才有泛光）、有生命感的运动。**

---

## 0. 项目地图与文件所有权（严禁跨文件写）

| 文件 | 职责 |
| --- | --- |
| `index.html` `src/style.css` | 页面骨架、HUD 视觉 |
| `src/main.js` | 主循环、场景调度、输入、HUD、自适应画质 |
| `src/post.js` `src/glutil.js` | HDR 后处理链、WebGL2 工具库 |
| `src/scenes/nebula.js` | 场景 1：GPGPU 粒子星云 |
| `src/scenes/tunnel.js` | 场景 2：光线步进霓虹隧道 |
| `src/scenes/fluid.js` | 场景 3：半拉格朗日墨流 |
| `src/audio.js` | 程序化环境音 + 频谱分析 |
| `verify/shot.mjs` | 无依赖截图/诊断 CLI |
| `README.md` `build.mjs` `serve.mjs` `dist/` | 文档、单文件打包、静态服务器 |

不要新增第三方依赖、CDN、外链字体或图片，全部程序化生成。

---

## 1. 场景接口（必须逐字实现）

每个场景一个经典脚本（**不要用 ES module**，`file://` 下要能跑），自注册：

```js
(function () {
  'use strict';
  const U = window.NEB.util;

  const scene = {
    meta: {
      id: 'nebula',        // 唯一 id
      title: 'NEBULA',     // 英文名（大写）
      cn: '星云',          // 中文名
      sub: 'GPGPU CURL FIELD', // 一行技术副标题
      accent: '#7df9ff',   // 主题色（HUD 会跟随）
      accent2: '#c77dff',  // 次色
      bloom: 1.0,          // 泛光强度系数（可选，默认 1）
    },

    // 只调用一次。可用 gl 和初始尺寸建资源。
    init(gl, w, h) {},

    // 画布/HDR 目标尺寸变化（含首次）。w,h 是设备像素，不是 CSS 像素。
    resize(w, h) {},

    // 每帧一次。dt 秒（暂停时为 0），t 为引擎累计时间秒。
    update(dt, t, input) {},

    // 把画面绘制到「主循环已经绑定好的 HDR FBO」上。
    // 不要 gl.bindFramebuffer(null)！不要自己设置 viewport（主循环已设）。
    // 可以绑定自己的 FBO，但画完必须恢复回主目标？不需要——主循环每帧都会重新绑定。
    render(t) {},

    stats: '262,144 PARTICLES', // 字符串或返回字符串的函数，显示在 HUD

    dispose() {}, // 可选
  };

  window.NEB.scenes.nebula = scene;
})();
```

可选钩子：`onActivate()`、`onDeactivate()`、`onReseed()`（按 R 键时调用，建议重置随机种子）。

**硬性约束**

- 不调用 `requestAnimationFrame` / `setTimeout` 驱动动画（主循环统一驱动），事件一律从 `input` 读。
- 不监听 pointer / key / resize。
- 不写 `console.log` 刷屏；调试完删掉。
- 不 `alert`。不引用外部 URL。
- 对 `resize` 必须稳妥：重分配 render target，不能崩、不能拉伸变形。
- 目标 60fps（Apple Silicon / 1440p）。重活可分帧或降内部渲染分辨率（如半分辨率 + 上采样）。
- 不要假设 DPR=1；一切以传进来的 w/h 为准。

---

## 2. `input` 对象（主循环每帧构造）

```js
{
  nx, ny,        // 平滑后的指针位置，[-1,1]，ny=+1 是屏幕上方
  u, v,          // 同上的 UV 坐标，[0,1]，v=+1 是屏幕上方
  px, py,        // 指针在 HDR target 中的像素坐标（GL 原点在左下）
  vx, vy,        // 指针速度（归一化坐标/秒，已平滑）
  down,          // 是否按住
  pulse,         // 点击冲击波强度 0..1，指数衰减，可持续读取
  pulseU, pulseV,// 最近一次点击的位置（UV）
  wheel,         // 本帧滚轮累计量（帧末清零），可做蓄能/缩放
  energy,        // 0..1 综合活跃度（移动 + 点击 + 音频）
  idle,          // 长时间无输入时为 true（此时 nx/ny 自动缓慢漂移，画面不会死）
  reducedMotion, // 系统偏好
  audio: { bass, mid, treble, level }, // 0..1，未开启音频时全 0
}
```

利用 `energy`、`pulse`、`audio.bass` 做联动，画面才会"活"。音频未开时必须有完整动效（不能依赖音频）。

---

## 3. 工具库 `window.NEB.util`（已初始化，直接可用）

```js
U.gl                       // WebGL2 上下文（也可用 init 参数里的 gl）
U.hdr                      // { internalFormat, format, type, floatRenderable }
U.fullscreenVS             // 全屏三角形顶点着色器源码（"#version 300 es" 开头）
U.compile(gl, type, src)   // 编译单个 shader；失败抛 Error（含日志）
U.program(gl, vsSrc, fsSrc)// 链接程序；失败抛 Error（含日志）
U.loc(gl, prog, name)      // 缓存 uniform location
U.tex(gl, w, h, opts)      // 创建 2D 纹理；opts: { internalFormat, format, type, filter, wrap, data }
U.target(gl, w, h, opts)   // 创建 { tex, fbo, w, h }，带完整性检查
U.pingpong(gl, w, h, opts) // GPU 乒乓：{ read:{tex,fbo}, write:{tex,fbo}, swap(), resize(w,h), w, h }
U.quad(gl)                 // 用全屏三角形画满当前 viewport（内部用 U.fullscreenVS 的 gl_VertexID 方案）
U.setTex(gl, unit, tex)    // activeTexture + bindTexture
U.u1f/u1i/u2f/u3f/u4f/uMat4(gl, prog, name, ...) // 设置 uniform 的简写
U.lerp, U.clamp, U.smoothstep
```

**HDR 说明**：主循环绑定的是 `RGBA16F` 目标（不支持浮点渲染时降级为 `RGBA8`，此时 >1 会被截断）。
想让泛光生效就输出 **大于 1.0** 的亮度。全屏三角形示例：

```js
const prog = U.program(gl, U.fullscreenVS, fragSrc);
gl.useProgram(prog);
U.setTex(gl, 0, someTex);
gl.uniform1i(U.loc(gl, prog, 'uTex'), 0);
U.quad(gl);
```

自定义顶点着色器（粒子）时照常 `createBuffer` / `vertexAttribPointer`；`#version 300 es` 必须写在第一行。

---

## 4. 后处理 / 视觉效果约定

- 场景目标会被主循环清成黑色，再调用 `render()`。
- 后处理链：亮部提取 → 降采样链 → 叠加式升采样 → ACES 色调映射 + 色差 + 暗角 + 胶片颗粒。
- 全屏输出由主循环完成；场景只负责 HDR 画面。
- 泛光阈值约 0.9：亮部（>1）越亮，光晕越强。适当给高光留过曝核心。
- 画面上不要出现纯色大面积死黑或纯白；保留层次。

---

## 5. 音频模块契约（`src/audio.js`）

```js
window.NEB.Audio = {
  on: false,                  // 当前是否开启
  ready: true,                // 是否可用（浏览器不支持则 false）
  async toggle(),             // 用户手势调用；返回切换后的 on 状态；内部负责 AudioContext resume
  sample(),                   // 返回 { bass, mid, treble, level }，0..1，关闭时全 0，绝不抛错
  dispose(),
};
```

要求：纯合成（无采样文件）、循环/有变化、安静不刺耳（master 约 0.18–0.3）、CPU 占用低；`sample()` 用 AnalyserNode 的频段能量归一化。主循环每帧读取 `sample()` 填入 `input.audio`。

---

## 6. 自测工具

```bash
node serve.mjs                       # 静态服务器，默认 127.0.0.1:5199
node verify/shot.mjs \
  --url=http://127.0.0.1:5199/ \
  --scene=nebula --wait=3500 \
  --out=shots/nebula.png --w=1440 --h=900
```

`shot.mjs` 会打印 JSON：控制台错误、FPS、`__NEB_DEBUG.sample()` 的画面亮度统计等。
**必须看截图**（可以直接读 PNG），确认真的好看，而不是"能跑"。

页面调试接口（可随意在 CDP / 控制台调用）：

```js
__NEB_DEBUG.ready          // 首帧完成
__NEB_DEBUG.fps            // EMA 帧率
__NEB_DEBUG.sceneId        // 当前场景 id
__NEB_DEBUG.glError        // gl.getError()
__NEB_DEBUG.switchScene('tunnel')
__NEB_DEBUG.sample()       // Promise<{avg,max,nonBlack,avgRGB}>，下一帧结束后解析
```

---

## 7. 验收标准（Definition of Done）

1. 场景在 1440×900 下 60fps 目标；不低于 45fps。控制台零报错。
2. 截图里画面有明确的主体、层次、色彩和运动感；HDR 高光会泛光；不是纯色噪点。
3. 指针交互（拖拽/点击）有可见、即时、愉悦的反馈。
4. 音频开启时画面有联动（即使未开也完整好看）。
5. `file://` 直开可用（无 fetch、无 module）。
6. 移动端 390×844 不破版、不崩。

完成后：用 `verify/shot.mjs` 截图自检，确认控制台零报错、画面有层次、60fps 目标；并在 `index.html` 中注册脚本、重新 `node build.mjs`。
