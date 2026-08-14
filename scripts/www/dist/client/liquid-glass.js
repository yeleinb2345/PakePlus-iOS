/*
 * MiniWorld Lua Editor - optional liquid-glass rendering layer.
 *
 * The rounded-rectangle SDF, surface-normal and chromatic refraction ideas are
 * adapted from martin65536/liquid-glass-webgl at commit
 * 79757c60f0f5cc23812a2c85fb9aaeffc87361e5 (Apache-2.0).
 * See THIRD_PARTY_NOTICES.md and LIQUID_GLASS_LICENSE.txt.
 */
(function (global) {
  "use strict";

  var SOURCE_COMMIT = "79757c60f0f5cc23812a2c85fb9aaeffc87361e5";
  var MAX_SHAPES = 8;
  var DESKTOP_PIXEL_CAP = 1600000;
  var MOBILE_PIXEL_CAP = 900000;
  var DESKTOP_DPR_CAP = 1.35;
  var TARGET_SELECTOR = ".event-cap, .if-frame, .condition-block, .action-block, .branch-placeholder";

  var state = {
    initialized: false,
    destroyed: false,
    ready: false,
    mode: "off",
    frames: 0,
    paused: true,
    bufferPixels: 0,
    dpr: 1,
    initMs: 0,
    contextLossCount: 0,
    lastError: "",
    shapeCount: 0,
    reducedMotion: false,
    mobile: false,
    visible: !document.hidden,
    canvas: null,
    host: null,
    app: null,
    content: null,
    gl: null,
    program: null,
    buffer: null,
    locations: null,
    rects: new Float32Array(MAX_SHAPES * 4),
    meta: new Float32Array(MAX_SHAPES * 4),
    pointer: [0, 0],
    dirty: false,
    geometryDirty: true,
    burstFrames: 0,
    raf: 0,
    lastFrameAt: 0,
    startedAt: 0,
    resizeObserver: null,
    mutationObserver: null,
    mediaQuery: null,
    cleanups: []
  };

  var vertexSource = [
    "attribute vec2 aPosition;",
    "void main() {",
    "  gl_Position = vec4(aPosition, 0.0, 1.0);",
    "}"
  ].join("\n");

  var fragmentSource = [
    "precision mediump float;",
    "#define MAX_SHAPES 8",
    "uniform vec2 uResolution;",
    "uniform vec2 uPointer;",
    "uniform float uTime;",
    "uniform float uDpr;",
    "uniform float uShapeCount;",
    "uniform vec4 uRects[MAX_SHAPES];",
    "uniform vec4 uMeta[MAX_SHAPES];",
    "",
    "float sdRoundedRect(vec2 p, vec2 halfSize, float radius) {",
    "  vec2 q = abs(p) - (halfSize - vec2(radius));",
    "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;",
    "}",
    "",
    "vec2 gradSdRoundedRect(vec2 p, vec2 halfSize, float radius) {",
    "  vec2 q = abs(p) - (halfSize - vec2(radius));",
    "  vec2 outside = max(q, 0.0);",
    "  if (outside.x + outside.y > 0.0001) {",
    "    return normalize(outside) * sign(p);",
    "  }",
    "  return q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));",
    "}",
    "",
    "vec2 circleMap(vec2 p, float radius) {",
    "  float safeRadius = max(radius, 1.0);",
    "  float distanceToCenter = min(length(p), safeRadius);",
    "  float dome = sqrt(max(safeRadius * safeRadius - distanceToCenter * distanceToCenter, 0.0));",
    "  return p * (1.0 + 0.055 * dome / safeRadius);",
    "}",
    "",
    "vec3 scene(vec2 uv) {",
    "  vec2 px = uv * uResolution / max(uDpr, 0.35);",
    "  float vertical = clamp(uv.y, 0.0, 1.0);",
    "  vec3 top = vec3(0.020, 0.095, 0.160);",
    "  vec3 bottom = vec3(0.010, 0.026, 0.070);",
    "  vec3 color = mix(bottom, top, vertical);",
    "  float cyanGlow = exp(-5.2 * length(uv - vec2(0.18, 0.77)));",
    "  float blueGlow = exp(-6.4 * length(uv - vec2(0.82, 0.28)));",
    "  color += vec3(0.015, 0.155, 0.215) * cyanGlow;",
    "  color += vec3(0.055, 0.075, 0.220) * blueGlow;",
    "  vec2 gridCell = abs(fract((px + vec2(0.0, uTime * 2.0)) / 30.0) - 0.5);",
    "  float gridLine = 1.0 - smoothstep(0.465, 0.5, max(gridCell.x, gridCell.y));",
    "  color += vec3(0.020, 0.125, 0.165) * gridLine * 0.18;",
    "  float wave = sin(px.x * 0.006 + px.y * 0.003 + uTime * 0.22) * 0.5 + 0.5;",
    "  color += vec3(0.006, 0.024, 0.042) * wave;",
    "  return color;",
    "}",
    "",
    "vec3 dispersedScene(vec2 uv, vec2 offset) {",
    "  vec2 stepOffset = offset / uResolution;",
    "  vec3 s0 = scene(clamp(uv - stepOffset * 1.50, 0.0, 1.0));",
    "  vec3 s1 = scene(clamp(uv - stepOffset * 1.00, 0.0, 1.0));",
    "  vec3 s2 = scene(clamp(uv - stepOffset * 0.50, 0.0, 1.0));",
    "  vec3 s3 = scene(clamp(uv, 0.0, 1.0));",
    "  vec3 s4 = scene(clamp(uv + stepOffset * 0.50, 0.0, 1.0));",
    "  vec3 s5 = scene(clamp(uv + stepOffset * 1.00, 0.0, 1.0));",
    "  vec3 s6 = scene(clamp(uv + stepOffset * 1.50, 0.0, 1.0));",
    "  float red = (s0.r + 2.0 * s1.r + 3.0 * s2.r + 2.0 * s3.r + s4.r) / 9.0;",
    "  float green = (s1.g + 2.0 * s2.g + 3.0 * s3.g + 2.0 * s4.g + s5.g) / 9.0;",
    "  float blue = (s2.b + 2.0 * s3.b + 3.0 * s4.b + 2.0 * s5.b + s6.b) / 9.0;",
    "  return vec3(red, green, blue);",
    "}",
    "",
    "vec3 tintForType(float type) {",
    "  if (type < 0.5) return vec3(0.045, 0.210, 0.275);",
    "  if (type < 1.5) return vec3(0.055, 0.205, 0.125);",
    "  if (type < 2.5) return vec3(0.055, 0.125, 0.285);",
    "  return vec3(0.245, 0.145, 0.035);",
    "}",
    "",
    "void main() {",
    "  vec2 screenPoint = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);",
    "  vec2 uv = screenPoint / uResolution;",
    "  vec3 color = scene(uv);",
    "  vec2 lightDirection = normalize(vec2(-0.64, -0.77));",
    "",
    "  for (int i = 0; i < MAX_SHAPES; i++) {",
    "    if (float(i) >= uShapeCount) continue;",
    "    vec4 rect = uRects[i];",
    "    vec4 meta = uMeta[i];",
    "    vec2 center = rect.xy + rect.zw * 0.5;",
    "    vec2 halfSize = max(rect.zw * 0.5, vec2(2.0));",
    "    vec2 local = screenPoint - center;",
    "    float radius = min(meta.x, min(halfSize.x, halfSize.y) - 0.5);",
    "    float distanceField = sdRoundedRect(local, halfSize, max(radius, 1.0));",
    "    float inside = 1.0 - smoothstep(-1.5 * uDpr, 1.5 * uDpr, distanceField);",
    "    if (inside <= 0.001) continue;",
    "",
    "    vec2 normal = gradSdRoundedRect(local, halfSize, max(radius, 1.0));",
    "    float domeRadius = max(length(halfSize), 1.0);",
    "    vec2 mapped = circleMap(local, domeRadius);",
    "    float edge = 1.0 - smoothstep(0.0, 15.0 * uDpr, abs(distanceField));",
    "    float pointerDistance = length((screenPoint - uPointer) / max(uResolution.x, uResolution.y));",
    "    float pointerLift = exp(-pointerDistance * 7.0);",
    "    vec2 lensOffset = (mapped - local) * 0.32 + normal * (4.0 + 4.0 * edge + 1.5 * pointerLift) * uDpr;",
    "    vec3 refracted = dispersedScene(uv, lensOffset);",
    "    vec3 tint = tintForType(meta.z);",
    "    refracted = mix(refracted, refracted + tint, 0.16 * meta.w);",
    "",
    "    float directionalRim = pow(max(dot(-normal, lightDirection), 0.0), 2.0);",
    "    float rim = edge * (0.18 + 0.62 * directionalRim);",
    "    float innerShade = smoothstep(-42.0 * uDpr, -3.0 * uDpr, distanceField);",
    "    vec3 glass = refracted + vec3(0.30, 0.82, 1.0) * rim * 0.42;",
    "    glass -= vec3(0.015, 0.025, 0.030) * innerShade;",
    "    color = mix(color, glass, inside * (0.54 + 0.28 * meta.w));",
    "  }",
    "",
    "  float vignette = 1.0 - smoothstep(0.28, 0.92, length(uv - 0.5));",
    "  color *= 0.86 + 0.14 * vignette;",
    "  gl_FragColor = vec4(color, 1.0);",
    "}"
  ].join("\n");

  function now() {
    return global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now();
  }

  function parseRequestedMode() {
    try {
      var value = new URLSearchParams(global.location.search).get("glass");
      if (value === "off") return "off";
      if (value === "fallback") return "css-fallback";
    } catch (error) {
      state.lastError = "无法读取液态玻璃查询参数";
    }
    if (global.__LIQUID_GLASS_DISABLE__ === true) return "off";
    if (global.__LIQUID_GLASS_FORCE_FALLBACK__ === true || global.__LIQUID_GLASS_FORCE_FALLBACK__ === "fallback") {
      return "css-fallback";
    }
    return "webgl";
  }

  function applyMode(mode, ready) {
    state.mode = mode;
    state.ready = Boolean(ready);
    state.paused = mode !== "webgl" || !state.raf;
    [state.app, state.host].forEach(function (element) {
      if (!element) return;
      element.setAttribute("data-glass-mode", mode);
      element.setAttribute("data-glass-ready", String(Boolean(ready)));
    });
  }

  function ensureCanvas() {
    var canvas = document.getElementById("liquid-glass-layer");
    if (canvas && canvas.tagName.toLowerCase() !== "canvas") return null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "liquid-glass-layer";
      canvas.className = "liquid-glass-layer";
      var viewport = state.host.querySelector(".canvas-viewport");
      state.host.insertBefore(canvas, viewport || null);
    }
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("role", "presentation");
    canvas.tabIndex = -1;
    canvas.setAttribute("data-source-commit", SOURCE_COMMIT);
    return canvas;
  }

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) throw new Error("无法创建 WebGL 着色器");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader) || "未知着色器错误";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    var vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    if (!program) throw new Error("无法创建 WebGL 程序");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var message = gl.getProgramInfoLog(program) || "未知链接错误";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function setupWebGL() {
    var gl = state.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power"
    });
    if (!gl) throw new Error("此浏览器未提供 WebGL 1");
    state.gl = gl;
    state.program = createProgram(gl);
    state.buffer = gl.createBuffer();
    if (!state.buffer) throw new Error("无法创建 WebGL 顶点缓冲区");

    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(state.program);

    var position = gl.getAttribLocation(state.program, "aPosition");
    if (position < 0) throw new Error("WebGL 顶点属性不可用");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    state.locations = {
      resolution: gl.getUniformLocation(state.program, "uResolution"),
      pointer: gl.getUniformLocation(state.program, "uPointer"),
      time: gl.getUniformLocation(state.program, "uTime"),
      dpr: gl.getUniformLocation(state.program, "uDpr"),
      shapeCount: gl.getUniformLocation(state.program, "uShapeCount"),
      rects: gl.getUniformLocation(state.program, "uRects[0]"),
      meta: gl.getUniformLocation(state.program, "uMeta[0]")
    };
  }

  function clearAnimationFrame() {
    if (state.raf) global.cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.paused = true;
  }

  function releaseWebGL(canCallContext) {
    var gl = state.gl;
    if (gl && canCallContext !== false) {
      if (state.buffer) gl.deleteBuffer(state.buffer);
      if (state.program) gl.deleteProgram(state.program);
    }
    state.buffer = null;
    state.program = null;
    state.locations = null;
    state.gl = null;
  }

  function useFallback(error, contextIsLost) {
    clearAnimationFrame();
    if (error) state.lastError = String(error.message || error).slice(0, 280);
    releaseWebGL(!contextIsLost);
    if (state.canvas) {
      state.canvas.width = 1;
      state.canvas.height = 1;
    }
    state.bufferPixels = 0;
    applyMode("css-fallback", true);
  }

  function targetKind(element) {
    if (element.classList.contains("event-cap")) return [0, 1.0];
    if (element.classList.contains("condition-block")) return [1, 0.92];
    if (element.classList.contains("action-block")) return [2, 0.96];
    if (element.classList.contains("if-frame")) return [3, 0.58];
    return [0, 0.54];
  }

  function collectTargets() {
    state.rects.fill(0);
    state.meta.fill(0);
    var hostRect = state.host.getBoundingClientRect();
    var dpr = state.dpr;
    var count = 0;
    var targets = state.host.querySelectorAll(TARGET_SELECTOR);

    for (var index = 0; index < targets.length && count < MAX_SHAPES; index += 1) {
      var target = targets[index];
      var rect = target.getBoundingClientRect();
      var style = global.getComputedStyle(target);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      var left = Math.max(0, rect.left - hostRect.left);
      var top = Math.max(0, rect.top - hostRect.top);
      var right = Math.min(hostRect.width, rect.right - hostRect.left);
      var bottom = Math.min(hostRect.height, rect.bottom - hostRect.top);
      var width = right - left;
      var height = bottom - top;
      if (width < 4 || height < 4) continue;

      var kind = targetKind(target);
      var radius = parseFloat(style.borderTopLeftRadius) || Math.min(18, height * 0.24);
      var rectOffset = count * 4;
      state.rects[rectOffset] = left * dpr;
      state.rects[rectOffset + 1] = top * dpr;
      state.rects[rectOffset + 2] = width * dpr;
      state.rects[rectOffset + 3] = height * dpr;
      state.meta[rectOffset] = Math.max(3, radius) * dpr;
      state.meta[rectOffset + 1] = kind[1];
      state.meta[rectOffset + 2] = kind[0];
      state.meta[rectOffset + 3] = kind[1];
      count += 1;
    }
    state.shapeCount = count;
    state.geometryDirty = false;
  }

  function resizeBuffer() {
    var rect = state.host.getBoundingClientRect();
    var cssWidth = Math.max(0, Math.round(rect.width));
    var cssHeight = Math.max(0, Math.round(rect.height));
    if (!cssWidth || !cssHeight) return false;

    state.mobile = global.matchMedia ? global.matchMedia("(max-width: 768px), (pointer: coarse)").matches : cssWidth <= 768;
    var baseDpr = state.mobile ? 1 : Math.min(global.devicePixelRatio || 1, DESKTOP_DPR_CAP);
    var pixelCap = state.mobile ? MOBILE_PIXEL_CAP : DESKTOP_PIXEL_CAP;
    var capDpr = Math.sqrt(pixelCap / Math.max(cssWidth * cssHeight, 1));
    var dpr = Math.max(0.35, Math.min(baseDpr, capDpr));
    var width = Math.max(1, Math.floor(cssWidth * dpr));
    var height = Math.max(1, Math.floor(cssHeight * dpr));
    state.dpr = dpr;
    state.bufferPixels = width * height;

    if (state.canvas.width !== width || state.canvas.height !== height) {
      state.canvas.width = width;
      state.canvas.height = height;
      state.geometryDirty = true;
      if (!state.pointer[0] && !state.pointer[1]) state.pointer = [width * 0.72, height * 0.18];
    }
    return true;
  }

  function draw(timestamp) {
    var gl = state.gl;
    if (!gl || !state.program || !resizeBuffer()) return;
    if (state.geometryDirty) collectTargets();

    gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.uniform2f(state.locations.resolution, state.canvas.width, state.canvas.height);
    gl.uniform2f(state.locations.pointer, state.pointer[0], state.pointer[1]);
    gl.uniform1f(state.locations.time, (timestamp - state.startedAt) / 1000);
    gl.uniform1f(state.locations.dpr, state.dpr);
    gl.uniform1f(state.locations.shapeCount, state.shapeCount);
    gl.uniform4fv(state.locations.rects, state.rects);
    gl.uniform4fv(state.locations.meta, state.meta);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    state.frames += 1;
  }

  function frame(timestamp) {
    state.raf = 0;
    if (state.destroyed || state.mode !== "webgl" || document.hidden) {
      state.paused = true;
      return;
    }
    if (!state.dirty && state.burstFrames <= 0) {
      state.paused = true;
      return;
    }
    state.dirty = false;
    state.lastFrameAt = timestamp;
    try {
      draw(timestamp);
    } catch (error) {
      useFallback(error, false);
      return;
    }

    if (!state.reducedMotion && !state.mobile && state.burstFrames > 0) {
      state.burstFrames -= 1;
      state.dirty = true;
      state.raf = global.requestAnimationFrame(frame);
      state.paused = false;
    } else {
      state.burstFrames = 0;
      state.paused = true;
    }
  }

  function requestRender(reason) {
    if (state.destroyed || state.mode !== "webgl") return false;
    if (reason !== "pointer") state.geometryDirty = true;
    if (reason === "pointer" && !state.reducedMotion && !state.mobile) {
      state.burstFrames = Math.max(state.burstFrames, 5);
    }
    state.dirty = true;
    if (document.hidden) {
      state.paused = true;
      return true;
    }
    if (!state.raf) {
      state.raf = global.requestAnimationFrame(frame);
      state.paused = false;
    }
    return true;
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.cleanups.push(function () { target.removeEventListener(type, handler, options); });
  }

  function setupObservers() {
    if (global.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(function () { requestRender("resize"); });
      state.resizeObserver.observe(state.host);
    } else {
      listen(global, "resize", function () { requestRender("resize"); }, { passive: true });
    }

    if (global.MutationObserver && state.content) {
      state.mutationObserver = new MutationObserver(function () { requestRender("mutation"); });
      state.mutationObserver.observe(state.content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"]
      });
    }

    listen(global, "scroll", function () { requestRender("scroll"); }, { passive: true, capture: true });
    listen(state.host, "pointermove", function (event) {
      var rect = state.host.getBoundingClientRect();
      state.pointer[0] = (event.clientX - rect.left) * state.dpr;
      state.pointer[1] = (event.clientY - rect.top) * state.dpr;
      requestRender("pointer");
    }, { passive: true });

    listen(document, "visibilitychange", function () {
      state.visible = !document.hidden;
      if (document.hidden) clearAnimationFrame();
      else requestRender("visible");
    });

    if (global.matchMedia) {
      state.mediaQuery = global.matchMedia("(prefers-reduced-motion: reduce)");
      state.reducedMotion = state.mediaQuery.matches;
      var onMotionChange = function (event) {
        state.reducedMotion = event.matches;
        state.burstFrames = 0;
        requestRender("motion");
      };
      if (state.mediaQuery.addEventListener) {
        state.mediaQuery.addEventListener("change", onMotionChange);
        state.cleanups.push(function () { state.mediaQuery.removeEventListener("change", onMotionChange); });
      } else if (state.mediaQuery.addListener) {
        state.mediaQuery.addListener(onMotionChange);
        state.cleanups.push(function () { state.mediaQuery.removeListener(onMotionChange); });
      }
    }
  }

  function onContextLost(event) {
    event.preventDefault();
    state.contextLossCount += 1;
    useFallback(new Error("WebGL 上下文已丢失，已安全切换为 CSS 效果"), true);
  }

  function initialize() {
    if (state.initialized || state.destroyed) return;
    state.initialized = true;
    state.startedAt = now();
    state.app = document.getElementById("app");
    state.host = document.getElementById("canvas");
    state.content = document.getElementById("canvas-content");
    if (!state.host || !state.app) {
      state.lastError = "未找到编辑器画布";
      state.ready = true;
      state.mode = "off";
      return;
    }

    state.canvas = ensureCanvas();
    if (!state.canvas) {
      state.lastError = "液态玻璃画布标识被其他元素占用";
      applyMode("css-fallback", true);
      return;
    }

    var requestedMode = parseRequestedMode();
    if (requestedMode === "off") {
      applyMode("off", true);
      state.initMs = Math.round(now() - state.startedAt);
      return;
    }
    if (requestedMode === "css-fallback") {
      applyMode("css-fallback", true);
      state.initMs = Math.round(now() - state.startedAt);
      return;
    }

    try {
      setupWebGL();
      listen(state.canvas, "webglcontextlost", onContextLost, false);
      setupObservers();
      applyMode("webgl", true);
      requestRender("init");
    } catch (error) {
      useFallback(error, false);
    }
    state.initMs = Math.round(now() - state.startedAt);
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    clearAnimationFrame();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.mutationObserver) state.mutationObserver.disconnect();
    while (state.cleanups.length) state.cleanups.pop()();
    releaseWebGL(true);
    if (state.canvas) {
      state.canvas.width = 1;
      state.canvas.height = 1;
    }
    state.bufferPixels = 0;
    applyMode("off", true);
  }

  function loseContext() {
    if (!state.gl || state.mode !== "webgl") return false;
    var extension = state.gl.getExtension("WEBGL_lose_context");
    if (!extension) {
      useFallback(new Error("浏览器不支持测试 WebGL 上下文丢失，已直接启用 CSS 回退"), false);
      return false;
    }
    extension.loseContext();
    return true;
  }

  function getDiagnostics() {
    return {
      mode: state.mode,
      ready: state.ready,
      frames: state.frames,
      paused: state.paused,
      bufferPixels: state.bufferPixels,
      dpr: Number(state.dpr.toFixed(3)),
      initMs: state.initMs,
      contextLossCount: state.contextLossCount,
      lastError: state.lastError,
      shapes: state.shapeCount,
      reducedMotion: state.reducedMotion,
      mobile: state.mobile,
      visible: state.visible,
      sourceCommit: SOURCE_COMMIT
    };
  }

  global.MiniWorldLiquidGlass = {
    getDiagnostics: getDiagnostics,
    requestRender: requestRender,
    loseContext: loseContext,
    destroy: destroy
  };

  function boot() {
    if (state.initialized || state.destroyed) return;
    var app = document.getElementById("app");
    if (app && app.getAttribute("data-ready") === "true") initialize();
  }

  global.addEventListener("miniworld-editor-ready", initialize, { once: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      boot();
      if (!state.initialized) global.setTimeout(initialize, 0);
    }, { once: true });
  } else {
    boot();
    if (!state.initialized) global.setTimeout(initialize, 0);
  }
})(window);
