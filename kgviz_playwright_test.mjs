import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8765/demo_map_pca.html';

function fmt(msg) {
  const loc = msg.location();
  const where = loc.url ? ` @ ${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : '';
  return `[${msg.type()}] ${msg.text()}${where}`;
}

function countBrightPixels(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].filter(c => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;
    });
    const threshold = 40; // bright vs dark bg ~#0e1117
    let totalBright = 0;
    const perCanvas = [];
    for (const c of canvases) {
      const w = c.width, h = c.height;
      if (!w || !h) { perCanvas.push({ w, h, bright: 0, visible: false }); continue; }
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        // WebGL canvas - read via 2d not available; use small offscreen copy trick
        perCanvas.push({ w, h, bright: null, note: 'webgl-no-2d-context' });
        continue;
      }
      let img;
      try { img = ctx.getImageData(0, 0, w, h); } catch (e) {
        perCanvas.push({ w, h, bright: null, error: String(e) });
        continue;
      }
      let bright = 0;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        if (a > 0 && (r > threshold || g > threshold || b > threshold)) bright++;
      }
      totalBright += bright;
      perCanvas.push({ w, h, bright, cssW: c.clientWidth, cssH: c.clientHeight });
    }
    return { totalBright, perCanvas, canvasCount: canvases.length };
  });
}

function countBrightPixelsWebGL(page) {
  return page.evaluate(() => {
    const threshold = 40;
    let totalBright = 0;
    const perCanvas = [];
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const w = Math.min(c.width, 512);
      const h = Math.min(c.height, 512);
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      try {
        ctx.drawImage(c, 0, 0, w, h);
      } catch (e) {
        perCanvas.push({ w: c.width, h: c.height, bright: null, drawError: String(e) });
        continue;
      }
      const d = ctx.getImageData(0, 0, w, h).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        const rr = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        if (a > 0 && (rr > threshold || g > threshold || b > threshold)) bright++;
      }
      totalBright += bright;
      perCanvas.push({ w: c.width, h: c.height, sampleW: w, sampleH: h, bright });
    }
    return { totalBright, perCanvas };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const initial = [];
const after3d = [];
const all = [];

page.on('console', msg => {
  const line = fmt(msg);
  all.push(line);
});
page.on('pageerror', err => {
  all.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const snap1 = [...all];

// Click 3D button
const btn3d = page.getByRole('button', { name: /^3D$/i });
if (await btn3d.count()) {
  await btn3d.first().click();
} else {
  const alt = page.locator('button:has-text("3D")');
  if (await alt.count()) await alt.first().click();
  else throw new Error('3D button not found');
}
await page.waitForTimeout(3000);
const snap2 = all.slice(snap1.length);

const bright1 = await countBrightPixelsWebGL(page);

await browser.close();

console.log('=== CONSOLE BEFORE 3D CLICK (includes load) ===');
for (const l of snap1) console.log(l);
console.log('=== CONSOLE AFTER 3D CLICK (+3s) ===');
for (const l of snap2) console.log(l);
console.log('=== BRIGHT PIXELS (after 3D, sampled) ===');
console.log(JSON.stringify(bright1, null, 2));
console.log('=== TOTAL CONSOLE LINES ===', all.length);
