import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const before = await page.evaluate(() => {
  const threshold = 40;
  let total = 0;
  const per = [];
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width <= 0) continue;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const ctx = off.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const rr = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      if (a > 0 && (rr > threshold || g > threshold || b > threshold)) bright++;
    }
    total += bright;
    per.push({ w: c.width, h: c.height, bright, pixels: off.width * off.height });
  }
  return { total, per };
});
await page.getByRole('button', { name: /^3D$/i }).first().click();
await page.waitForTimeout(3000);
const after = await page.evaluate(() => {
  const threshold = 40;
  let total = 0;
  const per = [];
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width <= 0) continue;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const ctx = off.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const rr = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      if (a > 0 && (rr > threshold || g > threshold || b > threshold)) bright++;
    }
    total += bright;
    per.push({ w: c.width, h: c.height, bright, pixels: off.width * off.height });
  }
  return { total, per };
});
await browser.close();
console.log(JSON.stringify({ before, after }, null, 2));
