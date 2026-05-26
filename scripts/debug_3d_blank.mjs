import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8765/demo_map_pca.html';

async function evaluateDebug(page, label) {
  return page.evaluate(async (lbl) => {
    const out = { label: lbl, timestamp: Date.now() };

    const canvases = Array.from(document.querySelectorAll('canvas'));
    out.canvasCount = canvases.length;
    out.canvases = canvases.map((c, i) => {
      const rect = c.getBoundingClientRect();
      const style = getComputedStyle(c);
      let glInfo = null;
      try {
        const gl =
          c.getContext('webgl2') ||
          c.getContext('webgl') ||
          c.getContext('experimental-webgl');
        if (gl) {
          glInfo = {
            version: gl.getParameter(gl.VERSION),
            renderer: gl.getParameter(gl.RENDERER),
            drawingBufferWidth: gl.drawingBufferWidth,
            drawingBufferHeight: gl.drawingBufferHeight,
          };
        }
      } catch (e) {
        glInfo = { error: String(e) };
      }
      return {
        index: i,
        width: c.width,
        height: c.height,
        clientWidth: c.clientWidth,
        clientHeight: c.clientHeight,
        rect: { w: rect.width, h: rect.height, x: rect.x, y: rect.y },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        hidden: c.hidden,
        parentTag: c.parentElement?.tagName,
        parentClass: c.parentElement?.className?.slice?.(0, 120),
        glInfo,
      };
    });

    out.globals = {};
    for (const key of [
      '__kgviz',
      '__KGVIZ__',
      'kgviz',
      'THREE',
      'ForceGraph3D',
      '__REACT_DEVTOOLS_GLOBAL_HOOK__',
    ]) {
      try {
        const v = globalThis[key];
        out.globals[key] =
          v === undefined
            ? undefined
            : v === null
              ? null
              : typeof v === 'function'
                ? '[function]'
                : typeof v === 'object'
                  ? `[object keys=${Object.keys(v).slice(0, 20).join(',')}]`
                  : String(v);
      } catch (e) {
        out.globals[key] = `error: ${e}`;
      }
    }

    if (globalThis.__kgviz && typeof globalThis.__kgviz === 'object') {
      try {
        out.__kgviz_detail = Object.keys(globalThis.__kgviz);
      } catch (_) {}
    }

    function findInstancedMesh(root, depth = 0, acc = []) {
      if (!root || depth > 40) return acc;
      const name = root.name || root.type || '';
      if (
        root.isInstancedMesh ||
        root.type === 'InstancedMesh' ||
        String(name).includes('__kgviz_instanced_points')
      ) {
        const entry = {
          name: root.name,
          type: root.type,
          count: root.count,
          visible: root.visible,
          frustumCulled: root.frustumCulled,
        };
        if (root.count > 0 && root.instanceMatrix) {
          const arr = root.instanceMatrix.array;
          entry.firstInstancePosition = [arr[12], arr[13], arr[14]];
        }
        acc.push(entry);
      }
      const children = root.children || [];
      for (let i = 0; i < children.length; i++) findInstancedMesh(children[i], depth + 1, acc);
      return acc;
    }

    function walkThreeScenes() {
      const scenes = [];
      const cameras = [];
      const meshes = [];

      function visit(obj, path) {
        if (!obj) return;
        if (obj.isScene) scenes.push({ path, children: obj.children?.length });
        if (obj.isCamera) {
          cameras.push({
            path,
            type: obj.type,
            position: obj.position
              ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
              : null,
          });
        }
        if (obj.isInstancedMesh || obj.type === 'InstancedMesh') {
          meshes.push({ path, name: obj.name, count: obj.count, visible: obj.visible });
        }
        const ch = obj.children || [];
        for (let i = 0; i < ch.length; i++) visit(ch[i], `${path}/${ch[i].name || ch[i].type || i}`);
      }

      document.querySelectorAll('canvas').forEach((c, i) => {
        const r = c.__threeRenderer || c._renderer || c.renderer;
        if (r?.scene) {
          visit(r.scene, `canvas[${i}].renderer.scene`);
          if (r.camera) {
            cameras.push({
              path: `canvas[${i}].renderer.camera`,
              type: r.camera.type,
              position: r.camera.position
                ? { x: r.camera.position.x, y: r.camera.position.y, z: r.camera.position.z }
                : null,
            });
          }
        }
      });

      if (globalThis.__kgviz) {
        const k = globalThis.__kgviz;
        for (const prop of ['scene', 'threeScene', 'graph', 'renderer', 'camera']) {
          if (k[prop]) visit(k[prop], `__kgviz.${prop}`);
        }
      }

      return { scenes, cameras, instancedMeshes: meshes };
    }

    out.threeWalk = walkThreeScenes();
    out.instancedByName = [];
    if (globalThis.THREE) {
      const tryRoots = [];
      if (globalThis.__kgviz?.scene) tryRoots.push(globalThis.__kgviz.scene);
      document.querySelectorAll('canvas').forEach((c) => {
        const r = c.__threeRenderer || c._renderer;
        if (r?.scene) tryRoots.push(r.scene);
      });
      for (const root of tryRoots) out.instancedByName.push(...findInstancedMesh(root));
    }

    return out;
  }, label);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const consoleLogs = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  console.log('Navigating to', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  const btn3d = page.getByRole('button', { name: /^3D$/i }).or(page.locator('button:has-text("3D")')).first();
  console.log('Button count:', await page.locator('button').count());

  let clicked = false;
  try {
    await btn3d.click({ timeout: 5000 });
    clicked = true;
    console.log('Clicked 3D');
  } catch (e) {
    console.log('3D click failed:', e.message);
    const alt = page.locator('text=3D').first();
    if (await alt.count()) {
      await alt.click();
      clicked = true;
    }
  }

  await page.waitForTimeout(3000);
  const after3s = await evaluateDebug(page, 'after_3d_click_3s');
  console.log('\n=== DEBUG after 3s ===');
  console.log(JSON.stringify(after3s, null, 2));

  await page.waitForTimeout(5000);
  const after8s = await evaluateDebug(page, 'after_3d_click_8s');
  console.log('\n=== DEBUG after 8s ===');
  console.log(JSON.stringify(after8s, null, 2));

  await page.screenshot({ path: '/Users/cnantasenamat/Documents/Coco/kgviz/scripts/debug_3d_blank.png' });

  if (consoleLogs.length) {
    console.log('\n=== Console (last 40) ===');
    consoleLogs.slice(-40).forEach((l) => console.log(l));
  }
  if (pageErrors.length) {
    console.log('\n=== Page errors ===');
    pageErrors.forEach((e) => console.log(e));
  }

  console.log('\nSummary:', {
    clicked3D: clicked,
    canvasAfter3s: after3s.canvasCount,
    canvasAfter8s: after8s.canvasCount,
    instancedMeshes3s: after3s.instancedByName?.length ?? 0,
    instancedMeshes8s: after8s.instancedByName?.length ?? 0,
    __kgviz_detail_8s: after8s.__kgviz_detail,
  });

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
