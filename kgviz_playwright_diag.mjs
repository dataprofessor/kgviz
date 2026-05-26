import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8765/demo_map_pca.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2000);
const before = await page.evaluate(() => {
  return [...document.querySelectorAll('canvas')].map((c,i) => {
    const r = c.getBoundingClientRect();
    const s = getComputedStyle(c);
    return { i, w: c.width, h: c.height, cssW: r.width, cssH: r.height, display: s.display, visibility: s.visibility, opacity: s.opacity, zIndex: s.zIndex };
  });
});
const titles = await page.evaluate(() => [...document.querySelectorAll('[title]')].map(el => ({ tag: el.tagName, title: el.getAttribute('title') })));
const btn3d = page.locator('[title="Switch to 3D view"]');
console.log('3d count', await btn3d.count());
await btn3d.first().click();
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  return [...document.querySelectorAll('canvas')].map((c,i) => {
    const r = c.getBoundingClientRect();
    const s = getComputedStyle(c);
    return { i, w: c.width, h: c.height, cssW: r.width, cssH: r.height, display: s.display, visibility: s.visibility, opacity: s.opacity, parentDisplay: c.parentElement ? getComputedStyle(c.parentElement).display : null };
  });
});
await browser.close();
console.log(JSON.stringify({ before, after, titles: titles.filter(t => t.title.includes('3D') || t.title.includes('Reset')) }, null, 2));
