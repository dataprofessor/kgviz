import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8765/demo_map_pca.html';

function countBrightCenter500(page) {
  return page.evaluate(() => {
    const RGB_SUM_MIN = 45;
    const per = [];
    let total = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const rect = c.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = window.getComputedStyle(c);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const w = c.width;
      const h = c.height;
      if (!w || !h) continue;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d');
      if (!ctx) {
        per.push({ w, h, bright: null, error: 'no-2d-context' });
        continue;
      }
      try {
        ctx.drawImage(c, 0, 0);
      } catch (e) {
        per.push({ w, h, bright: null, drawError: String(e) });
        continue;
      }
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const half = 250;
      const x0 = Math.max(0, cx - half);
      const y0 = Math.max(0, cy - half);
      const x1 = Math.min(w, cx + half);
      const y1 = Math.min(h, cy + half);
      const sw = x1 - x0;
      const sh = y1 - y0;
      let bright = 0;
      const img = ctx.getImageData(x0, y0, sw, sh);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        if (a > 0 && r + g + b > RGB_SUM_MIN) bright++;
      }
      total += bright;
      per.push({
        w,
        h,
        cssW: rect.width,
        cssH: rect.height,
        centerRegion: { x0, y0, sw, sh },
        bright,
      });
    }
    return { total, per, visibleCanvasCount: per.length };
  });
}

const consoleLines = [];
const consoleErrors = [];

function recordConsole(msg) {
  const loc = msg.location();
  const where = loc.url ? ` @ ${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : '';
  const line = `[${msg.type()}] ${msg.text()}${where}`;
  consoleLines.push(line);
  if (msg.type() === 'error') consoleErrors.push(line);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', recordConsole);
page.on('pageerror', (err) => {
  const line = `[pageerror] ${err.message}`;
  consoleLines.push(line);
  consoleErrors.push(line);
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const bright2d = await countBrightCenter500(page);

const btn3d = page.getByRole('button', { name: /^3D$/i });
if (!(await btn3d.count())) throw new Error('3D button not found');
await btn3d.first().click();
await page.waitForTimeout(4000);
const bright3d = await countBrightCenter500(page);

const resetBtn = page.locator('[title="Reset view"]');
if (!(await resetBtn.count())) throw new Error('Reset view button not found');
await resetBtn.first().click();
await page.waitForTimeout(1000);
const brightAfterReset = await countBrightCenter500(page);

await browser.close();

const success = bright3d.total > 500;
const report = {
  success,
  criteria: '3D visible canvas center 500x500 RGB sum > 45; success if total bright > 500 after 3D',
  bright2d_after_2s: bright2d,
  bright3d_after_4s: bright3d,
  brightAfterReset_after_1s: brightAfterReset,
  consoleErrors,
  allConsoleLines: consoleLines,
};
console.log(JSON.stringify(report, null, 2));
process.exit(success ? 0 : 1);
