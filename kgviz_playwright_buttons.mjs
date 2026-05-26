import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => ({ text: b.textContent?.trim(), title: b.title, aria: b.getAttribute('aria-label') })));
const role3d = page.getByRole('button', { name: /^3D$/i });
console.log('role 3D count', await role3d.count());
if (await role3d.count()) {
  const info = await role3d.first().evaluate(el => ({ text: el.textContent, title: el.title }));
  console.log('matched', info);
  await role3d.first().click();
}
await page.waitForTimeout(4000);
const stats = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const off = document.createElement('canvas');
  off.width = c.width; off.height = c.height;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const img = ctx.getImageData(390, 150, 500, 500);
  let sum45 = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i+3] > 0 && img.data[i]+img.data[i+1]+img.data[i+2] > 45) sum45++;
  }
  const titles = [...document.querySelectorAll('[title*="3D"],[title*="2D"]')].map(e => e.getAttribute('title'));
  return { sum45, titles };
});
console.log(JSON.stringify({ buttons, stats }, null, 2));
await browser.close();
