import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);

async function stats(label) {
  return page.evaluate((label) => {
    const c = [...document.querySelectorAll('canvas')].find(c => c.getBoundingClientRect().width > 0);
    if (!c) return { label, error: 'no canvas' };
    const w = c.width, h = c.height;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const cx = Math.floor(w/2), cy = Math.floor(h/2);
    const x0 = Math.max(0, cx-250), y0 = Math.max(0, cy-250);
    const img = ctx.getImageData(x0, y0, 500, 500);
    const d = img.data;
    let maxSum = 0, sum45 = 0, sum30 = 0, ch40 = 0, nonzero = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      if (a === 0) continue;
      nonzero++;
      const s = r+g+b;
      if (s > maxSum) maxSum = s;
      if (s > 45) sum45++;
      if (s > 30) sum30++;
      if (r > 40 || g > 40 || b > 40) ch40++;
    }
    const corner = ctx.getImageData(0,0,1,1).data;
    return { label, w, h, maxSum, sum45, sum30, ch40, nonzero, corner: [...corner] };
  }, label);
}

const s2d = await stats('2d');
await page.locator('[title="Switch to 3D view"]').first().click();
await page.waitForTimeout(4000);
const s3d = await stats('3d');
await page.locator('[title="Reset view"]').first().click();
await page.waitForTimeout(1000);
const sReset = await stats('reset');
await browser.close();
console.log(JSON.stringify({ s2d, s3d, sReset }, null, 2));
