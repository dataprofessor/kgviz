import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /^3D$/i }).first().click();
for (const wait of [4000, 8000, 12000]) {
  await page.waitForTimeout(wait === 4000 ? 4000 : wait - (wait === 8000 ? 4000 : 8000));
  const s = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = c.width, h = c.height;
    const buf = new Uint8Array(w*h*4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let maxSum = 0, sum45 = 0, allZero = true;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i]||buf[i+1]||buf[i+2]||buf[i+3]) allZero = false;
      const s = buf[i]+buf[i+1]+buf[i+2];
      if (s > maxSum) maxSum = s;
      if (buf[i+3] > 0 && s > 45) sum45++;
    }
    const err = gl.getError();
    return { maxSum, sum45, allZero, glError: err, sample: [...buf.slice(0,16)] };
  });
  console.log('wait ms cumulative', wait, JSON.stringify(s));
}
await browser.close();
