/*
 * Sketch-to-colour painting animation
 * Plain HTML + CSS + JavaScript. No libraries, no build step.
 *
 * Phase 1: a pencil sketch (generated from the painting) is revealed with hatching strokes.
 * Phase 2: a soft "underpainting" is brushed in, then the original colours with bristle strokes.
 */
(() => {
  'use strict';

  /* ================= Settings you can tweak ================= */
  const IMAGE_FILE = 'painting.jpg';                 // the painting next to index.html
  const DURATION = { sketch: 16, hold: 1.2, colour: 24 }; // seconds at 1x speed
  const PAPER = [246, 241, 228];                     // paper colour (R, G, B)
  const GRAPHITE = [52, 52, 58];                     // pencil colour (R, G, B)
  const IS_PHONE = Math.min(window.innerWidth, window.innerHeight) < 600;
  const MIN_SIDE = IS_PHONE ? 800 : 900;             // working resolution (longest side)
  const MAX_SIDE = IS_PHONE ? 1000 : 1400;           // lower this if the animation feels slow
  const RAMP_START = 0.93;                           // last 7% of each phase fades any gaps closed

  /* ================= Page elements ================= */
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const ctx = stage.getContext('2d');
  const btnStart = $('btnStart');
  const btnPause = $('btnPause');
  const btnRestart = $('btnRestart');
  const speedInput = $('speed');
  const speedLabel = $('speedLabel');
  const statusEl = $('status');
  const barFill = $('barFill');
  const fileInput = $('fileInput');
  const messageEl = $('message');

  /* ================= State ================= */
  let W = 0, H = 0, U = 1;                 // canvas size, and U = size unit (1 at 1000px)
  let paperC, sketchC, underC, finalC;     // image layers
  let maskS, maskA, maskB, tmpC;           // brush masks + scratch canvas
  let msCtx, maCtx, mbCtx, tmpCtx;
  let sketchStrokes = [], colourStrokes = [];
  let sIdx = 0, cIdx = 0;
  let rampS = 0, rampC = 0;
  let mode = 'loading';                    // loading | idle | playing | paused | done
  let elapsed = 0;                         // seconds of animation time
  let lastTs = 0;
  let rafId = 0;
  let speed = parseFloat(speedInput.value) || 1;

  const TOTAL = DURATION.sketch + DURATION.hold + DURATION.colour;

  /* ================= Helpers ================= */
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

  let seed = 1;                            // small seeded random generator (mulberry32)
  function rnd() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = !text;
  }

  /* ================= Image processing ================= */

  // One horizontal or vertical box-blur pass (running sum, edges clamped).
  function blurPass(src, dst, w, h, r, horizontal) {
    const len = horizontal ? w : h;
    const outer = horizontal ? h : w;
    const stride = horizontal ? 1 : w;
    const outerStride = horizontal ? w : 1;
    const inv = 1 / (2 * r + 1);
    for (let o = 0; o < outer; o++) {
      const base = o * outerStride;
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        sum += src[base + Math.min(len - 1, Math.max(0, k)) * stride];
      }
      for (let i = 0; i < len; i++) {
        dst[base + i * stride] = sum * inv;
        const add = Math.min(len - 1, i + r + 1);
        const sub = Math.max(0, i - r);
        sum += src[base + add * stride] - src[base + sub * stride];
      }
    }
  }

  // Three box blurs in a row look very close to a Gaussian blur.
  function gaussianBlur(src, w, h, r) {
    const a = Float32Array.from(src);
    const b = new Float32Array(src.length);
    for (let pass = 0; pass < 3; pass++) {
      blurPass(a, b, w, h, r, true);
      blurPass(b, a, w, h, r, false);
    }
    return a;
  }

  // Builds the paper, pencil-sketch and soft underpainting layers from the colour pixels.
  function buildLayers(data) {
    const n = W * H;
    const gray = new Float32Array(n);
    const inverted = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      gray[i] = g;
      inverted[i] = 255 - g;
    }
    // Classic pencil effect: grayscale "colour-dodged" by a blurred negative.
    const blurred = gaussianBlur(inverted, W, H, Math.max(2, Math.round(5 * U)));

    const paperImg = new ImageData(W, H);
    const sketchImg = new ImageData(W, H);
    const underImg = new ImageData(W, H);
    const pd = paperImg.data, sd = sketchImg.data, ud = underImg.data;
    const period = (2 * Math.PI) / (5 * U);   // spacing of the diagonal hatching

    seed = 12345;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const p = i * 4;
        const noise = rnd();

        // paper with a little grain
        const tooth = 0.965 + 0.035 * noise;
        const pr = PAPER[0] * tooth, pg = PAPER[1] * tooth, pb = PAPER[2] * tooth;
        pd[p] = pr; pd[p + 1] = pg; pd[p + 2] = pb; pd[p + 3] = 255;

        // pencil tone
        const g = gray[i];
        let v = Math.min(255, (g * 255) / Math.max(1, 255 - blurred[i]));
        v = v * 0.78 + g * 0.22;                       // keep a hint of tone
        v = clamp01((v - 40) / 195);
        v = Math.pow(v, 1.15);
        let d = (1 - v) * 0.92;                        // d = how much graphite here
        if (d > 0.15) {                                // hatching in the darker areas
          const s = 0.5 + 0.5 * Math.sin((x + y) * period);
          d *= 1 - 0.4 * s * Math.min(1, (d - 0.15) * 3);
        }
        d *= 0.88 + 0.24 * noise;                      // graphite grain
        d = clamp01(d);

        sd[p]     = pr * (1 - d) + GRAPHITE[0] * d;
        sd[p + 1] = pg * (1 - d) + GRAPHITE[1] * d;
        sd[p + 2] = pb * (1 - d) + GRAPHITE[2] * d;
        sd[p + 3] = 255;

        // soft underpainting: half-saturated, lightened, with pencil lines showing through
        const k = 0.62 + 0.38 * (1 - d);
        ud[p]     = ((g + (data[p]     - g) * 0.55) * 0.88 + pr * 0.12) * k;
        ud[p + 1] = ((g + (data[p + 1] - g) * 0.55) * 0.88 + pg * 0.12) * k;
        ud[p + 2] = ((g + (data[p + 2] - g) * 0.55) * 0.88 + pb * 0.12) * k;
        ud[p + 3] = 255;
      }
    }

    paperC = makeCanvas(W, H);
    sketchC = makeCanvas(W, H);
    underC = makeCanvas(W, H);
    paperC.getContext('2d').putImageData(paperImg, 0, 0);
    sketchC.getContext('2d').putImageData(sketchImg, 0, 0);
    underC.getContext('2d').putImageData(underImg, 0, 0);
  }

  /* ================= Brush strokes ================= */

  // A stroke is drawn as many thin, slightly different "bristles", which gives
  // ragged, streaky edges like a real brush (or pencil hatching when it is narrow).
  function drawStroke(c, s) {
    const dx = Math.cos(s.a), dy = Math.sin(s.a);
    const nx = -dy, ny = dx;
    const bristles = Math.max(3, Math.round(s.wd / (2.2 * U)));
    const curve = (rnd() - 0.5) * s.len * 0.25;
    for (let i = 0; i < bristles; i++) {
      const o = ((i + rnd() * 0.8) / bristles - 0.5) * s.wd;     // sideways offset
      const edge = Math.abs(o) / (s.wd / 2);
      const shrink = edge * edge * s.len * 0.12;                 // edge bristles run shorter
      const l0 = -s.len / 2 + rnd() * s.len * 0.18 + shrink;
      const l1 = s.len / 2 - rnd() * s.len * 0.18 - shrink;
      c.globalAlpha = 0.55 + rnd() * 0.45;
      c.lineWidth = (2.4 + rnd() * 2.6) * U;
      c.beginPath();
      c.moveTo(s.x + dx * l0 + nx * o, s.y + dy * l0 + ny * o);
      c.quadraticCurveTo(
        s.x + nx * (o + curve), s.y + ny * (o + curve),
        s.x + dx * l1 + nx * o, s.y + dy * l1 + ny * o
      );
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Walk a grid of cells and call make(x, y, k) for each stroke inside it.
  function grid(cell, perCell, make) {
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil(H / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < perCell; k++) {
          make((c + rnd()) * cell, (r + rnd()) * cell, k);
        }
      }
    }
  }

  // "Sweep" order: mostly top-to-bottom and left-to-right, with a ragged, organic edge.
  const sweep = (x, y) => 0.45 * (y / H) + 0.35 * (x / W) + 0.2 * rnd();

  function buildStrokes() {
    seed = (Math.random() * 1e9) | 0;

    // Pencil hatching, revealed at an even pace
    sketchStrokes = [];
    grid(14 * U, 3, (x, y) => {
      const wd = 22 * U;
      sketchStrokes.push({
        x, y, wd,
        a: -0.8 + (rnd() - 0.5) * 0.6,
        len: wd * (1.6 + rnd() * 1.2),
        t: sweep(x, y)
      });
    });
    sketchStrokes.sort((p, q) => p.t - q.t);
    sketchStrokes.forEach((s, i) => { s.t = i / (sketchStrokes.length - 1); });

    // Colour: big underpainting strokes (m=0), then medium and small colour strokes (m=1)
    colourStrokes = [];
    const add = (cell, per, wd, m, t0, tScale) => {
      grid(cell * U, per, (x, y) => {
        colourStrokes.push({
          x, y, m,
          wd: wd * U,
          a: 0.25 + rnd() * 0.9,
          len: wd * U * (1.6 + rnd() * 1.2),
          t: t0 + tScale * sweep(x, y)
        });
      });
    };
    add(44, 2, 72, 0, 0.00, 0.55);
    add(28, 2, 46, 1, 0.20, 0.60);
    add(14, 1, 22, 1, 0.45, 0.55);
    colourStrokes.sort((p, q) => p.t - q.t);
  }

  function resetMasks() {
    for (const c of [msCtx, maCtx, mbCtx]) {
      c.clearRect(0, 0, W, H);
      c.strokeStyle = '#fff';
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }
  }

  /* ================= Animation ================= */

  function advanceStrokes() {
    const t1 = DURATION.sketch;
    const t2 = t1 + DURATION.hold;

    // --- pencil sketch ---
    const ps = clamp01(elapsed / t1);
    const targetS = clamp01(ps / RAMP_START);
    while (sIdx < sketchStrokes.length && sketchStrokes[sIdx].t <= targetS) {
      drawStroke(msCtx, sketchStrokes[sIdx++]);
    }
    rampS = smooth((ps - RAMP_START) / (1 - RAMP_START));

    // --- colour ---
    const pc = clamp01((elapsed - t2) / DURATION.colour);
    if (elapsed >= t2) {
      const targetC = clamp01(pc / RAMP_START);
      while (cIdx < colourStrokes.length && colourStrokes[cIdx].t <= targetC) {
        const s = colourStrokes[cIdx++];
        drawStroke(s.m === 0 ? maCtx : mbCtx, s);
      }
    }
    rampC = smooth((pc - RAMP_START) / (1 - RAMP_START));
  }

  // Draws `layer` through `mask` (only where the mask has paint) onto the stage.
  function drawMasked(layer, mask) {
    tmpCtx.globalCompositeOperation = 'source-over';
    tmpCtx.clearRect(0, 0, W, H);
    tmpCtx.drawImage(layer, 0, 0);
    tmpCtx.globalCompositeOperation = 'destination-in';
    tmpCtx.drawImage(mask, 0, 0);
    ctx.drawImage(tmpC, 0, 0);
  }

  function drawFaded(layer, alpha) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.drawImage(paperC, 0, 0);

    if (mode === 'idle' || mode === 'loading') {
      ctx.save();
      ctx.font = `${30 * U}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(90, 80, 70, 0.55)';
      ctx.fillText(mode === 'idle' ? 'Press Start' : 'Loading…', W / 2, H / 2);
      ctx.restore();
      return;
    }

    if (mode === 'done') {
      ctx.drawImage(finalC, 0, 0);
      return;
    }

    const t2 = DURATION.sketch + DURATION.hold;
    if (elapsed < t2) {
      drawMasked(sketchC, maskS);
      drawFaded(sketchC, rampS);
    } else {
      ctx.drawImage(sketchC, 0, 0);
      drawMasked(underC, maskA);
      drawMasked(finalC, maskB);
      drawFaded(finalC, rampC);
    }
  }

  function updateUI() {
    barFill.style.width = `${clamp01(elapsed / TOTAL) * 100}%`;
    const t1 = DURATION.sketch;
    const t2 = t1 + DURATION.hold;
    let text = '';
    if (mode === 'idle') text = 'Ready. Press Start.';
    else if (mode === 'done') text = 'Finished. Press Restart to watch again.';
    else if (elapsed < t1) text = 'Sketching with pencil…';
    else if (elapsed < t2) text = 'Sketch complete…';
    else text = 'Painting with brushes…';
    if (mode === 'paused') text = `Paused. ${text}`;
    statusEl.textContent = text;

    btnStart.disabled = mode !== 'idle';
    btnPause.disabled = mode !== 'playing' && mode !== 'paused';
    btnPause.textContent = mode === 'paused' ? '▶ Resume' : '⏸ Pause';
    btnRestart.disabled = mode === 'idle' || mode === 'loading';
  }

  function tick(ts) {
    if (mode !== 'playing') return;
    const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    elapsed += dt * speed;

    if (elapsed >= TOTAL) {
      elapsed = TOTAL;
      mode = 'done';
      render();
      updateUI();
      return;
    }
    advanceStrokes();
    render();
    updateUI();
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    mode = 'playing';
    lastTs = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    updateUI();
  }

  function resetState() {
    cancelAnimationFrame(rafId);
    elapsed = 0;
    sIdx = 0;
    cIdx = 0;
    rampS = 0;
    rampC = 0;
    buildStrokes();
    resetMasks();
  }

  /* ================= Loading the painting ================= */

  function setup(img) {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const longest = Math.max(nw, nh);
    const scale = Math.min(MAX_SIDE, Math.max(MIN_SIDE, longest)) / longest;
    W = Math.round(nw * scale);
    H = Math.round(nh * scale);
    U = Math.max(W, H) / 1000;

    stage.width = W;    // the canvas takes the painting's exact proportions
    stage.height = H;

    finalC = makeCanvas(W, H);
    const fctx = finalC.getContext('2d', { willReadFrequently: true });
    fctx.fillStyle = '#fff';
    fctx.fillRect(0, 0, W, H);
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(img, 0, 0, W, H);

    let pixels;
    try {
      pixels = fctx.getImageData(0, 0, W, H);
    } catch (err) {
      showMessage(
        'The browser blocked reading the image pixels. This happens when index.html is opened by ' +
        'double-clicking it. Open it with the VS Code "Live Server" extension instead, or click ' +
        '"Upload image" and pick the picture again.'
      );
      return false;
    }

    buildLayers(pixels.data);

    maskS = makeCanvas(W, H);
    maskA = makeCanvas(W, H);
    maskB = makeCanvas(W, H);
    tmpC = makeCanvas(W, H);
    msCtx = maskS.getContext('2d');
    maCtx = maskA.getContext('2d');
    mbCtx = maskB.getContext('2d');
    tmpCtx = tmpC.getContext('2d');
    return true;
  }

  function loadImage(src, autoplay) {
    cancelAnimationFrame(rafId);
    mode = 'loading';
    showMessage('');
    statusEl.textContent = 'Loading painting…';
    updateUI();

    const img = new Image();
    img.onload = () => {
      if (!setup(img)) {
        statusEl.textContent = 'Could not read the image.';
        return;
      }
      resetState();
      mode = 'idle';
      render();
      updateUI();
      if (autoplay) play();
    };
    img.onerror = () => {
      if (src === IMAGE_FILE) {
        statusEl.textContent = 'Painting not found.';
        showMessage(
          `Could not load "${IMAGE_FILE}". Save a picture in the same folder as index.html with ` +
          'exactly that name, or press "Upload image" to pick one.'
        );
      } else {
        showMessage('That file could not be opened. Please try a JPG, PNG or WebP image.');
        if (paperC) {
          resetState();
          mode = 'idle';
          render();
        }
      }
      updateUI();
    };
    img.src = src;
  }

  /* ================= Controls ================= */

  btnStart.addEventListener('click', () => {
    if (mode === 'idle') play();
  });

  btnPause.addEventListener('click', () => {
    if (mode === 'playing') {
      mode = 'paused';
      cancelAnimationFrame(rafId);
      updateUI();
    } else if (mode === 'paused') {
      play();
    }
  });

  btnRestart.addEventListener('click', () => {
    if (mode === 'loading') return;
    resetState();
    play();
  });

  speedInput.addEventListener('input', () => {
    speed = parseFloat(speedInput.value) || 1;
    speedLabel.textContent = `${speed}×`;
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });

  let objectUrl = null;
  function handleFile(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      showMessage('Please choose an image file (JPG, PNG or WebP).');
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    loadImage(objectUrl, true);          // start the animation straight away
  }

  const wrap = document.querySelector('.stage-wrap');
  ['dragenter', 'dragover'].forEach((ev) => wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.classList.remove('drag');
  }));
  wrap.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('btnSample').addEventListener('click', () => loadImage(IMAGE_FILE, true));

  speedLabel.textContent = `${speed}×`;
  updateUI();
  loadImage(IMAGE_FILE, false);
})();
