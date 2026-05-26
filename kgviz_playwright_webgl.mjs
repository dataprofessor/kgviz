import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';

function countBright(page) {
  return page.evaluate(() => {
    const RGB_SUM_MIN = 45;
    let total = 0;
    const per = [];
    for (const c of document.querySelectorAll('canvas')) {
      const rect = c.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const w = c.width, h = c.height;
      const cx = Math.floor(w/2), cy = Math.floor(h/2);
      const x0 = Math.max(0, cx-250), y0 = Math.max(0, cy-250);
      const sw = Math.min(500, w-x0), sh = Math.min(500, h-y0);
      let bright = 0;
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const buf = new Uint8Array(sw * sh * 4);
        gl.readPixels(x0, h - y0 - sh, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (let i = 0; i < buf.length; i += 4) {
          const r = buf[i], g = buf[i+1], b = buf[i+2], a = buf[i+3];
          if (a > 0 && r+g+b > RGB_SUM_MIN) bright++;
        }
        per.push({ w, h, method: 'webgl', bright, cssW: rect.width });
      } else {
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(x0, y0, sw, sh);
        for (let i = 0; i < img.data.length; i += 4) {
          const r = img.data[i], g = img.data[i+1], b = img.data[i+2], a = img.data[i+3];
          if (a > 0 && r+g+b > RGB_SUM_MIN) bright++;
        }
        per.push({ w, h, method: '2d', bright, cssW: rect.width });
      }
      total += bright;
    }
    return { total, per };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const d2 = await countBright(page);
await page.getByRole('button', { name: /^3D$/i }).first().click();
await page.waitForTimeout(4000);
const d3 = await countBright(page);
await page.locator('[title="Reset view"]').first().click();
await page.waitForTimeout(1000);
const dr = await countBright(page);
await browser.close();
console.log(JSON.stringify({ d2, d3, dr, success: d3.total > 500 }, null, 2));
