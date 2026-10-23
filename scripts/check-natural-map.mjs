// Optional real-browser acceptance. Install Playwright separately, or provide
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs. No runtime dependency.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = resolve(process.env.ARTIFACT_DIR || '.cache/natural-map-qa');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { browser: browser.version(), seed: 'jinglun-040', cases: [], errors: [] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let surfaceDigest;
let currentPage;
async function ready(page, count) {
  await page.waitForFunction(count => document.querySelectorAll('.world-svg .cell').length === count, count);
  await page.waitForSelector('.map-overlay', { state: 'hidden', timeout: 60000 });
}
async function snapshot(page) {
  return page.evaluate(() => ({
    camera: document.querySelector('.world-svg > g').getAttribute('transform'),
    selection: document.querySelector('.selected-ants')?.getAttribute('points'),
  }));
}
async function open(count, options = {}, legacy = false) {
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, colorScheme: 'light', reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/maps/generate') && request.method() === 'POST') requests++; });
  await page.addInitScript(count => {
    localStorage.setItem('jinglun.map-settings.v1', JSON.stringify({ seed: 'jinglun-040', cell_count: count, relaxations: 2, land_ratio: 0.45 }));
    localStorage.setItem('jinglun.theme', 'light');
  }, count);
  // Capture through APIRequestContext rather than CDP's bounded inspector
  // cache: 2,000-cell payloads can exceed its default response-body quota.
  let captured;
  const response = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/maps/generate', async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (legacy) delete body.map.environment.natural_surface;
    captured(body);
    await route.fulfill({ response, json: body });
  });
  await page.goto(base);
  const data = await response;
  await ready(page, count);
  return { context, page, data, requests: () => requests };
}
const style = (page, name) => page.getByRole('button', { name, exact: true }).click();
const screenshot = (page, name) => page.screenshot({ path: join(out, name + '.png'), animations: 'disabled' });
try {
  for (const count of [100, 500, 2000]) {
    console.log('Checking', count, 'cells');
    const { context, page, data, requests } = await open(count);
    const thisDigest = digest(data.map.environment.natural_surface);
    if (surfaceDigest) assert.equal(thisDigest, surfaceDigest, 'natural geometry must not depend on region density');
    surfaceDigest = thisDigest;
    await page.keyboard.press('['); await page.keyboard.press(']'); await page.keyboard.press('g');
    await page.keyboard.press('Home');
    const cell = [...data.map.cells].sort((a, b) =>
      Math.hypot(a.centroid.x - 800, a.centroid.y - 500) - Math.hypot(b.centroid.x - 800, b.centroid.y - 500))[0];
    const screen = await page.locator(`[data-cell="${cell.id}"]`).evaluate((el, point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(el.getScreenCTM());
      return { x: screen.x, y: screen.y };
    }, cell.centroid);
    await page.mouse.click(screen.x, screen.y);
    assert.equal((await snapshot(page)).selection, await page.locator(`[data-cell="${cell.id}"]`).getAttribute('points'), 'real pointer hit must resolve the underlying governance cell');
    let candidateCount;
    if (count === 100) {
      await page.keyboard.press(']');
      await page.getByRole('button', { name: '加入所选地块', exact: true }).click();
      candidateCount = await page.locator('.comparison-controls strong').textContent();
      assert.equal(candidateCount, '候选地 1/4');
      await page.keyboard.press(']');
    }
    const before = await snapshot(page);
    const oldMinimap = await page.locator('.minimap canvas').evaluate(canvas => canvas.toDataURL());
    if (count === 100) await screenshot(page, 'classic-100');
    await style(page, '自然地形');
    await page.waitForSelector('.world-svg[data-map-style="natural"]');
    assert.deepEqual(await snapshot(page), before);
    assert.notEqual(await page.locator('.minimap canvas').evaluate(canvas => canvas.toDataURL()), oldMinimap);
    await screenshot(page, `natural-${count}`);
    const nextCell = [...data.map.cells].filter(next => next.id !== cell.id).sort((a, b) =>
      Math.hypot(a.centroid.x - 950, a.centroid.y - 550) - Math.hypot(b.centroid.x - 950, b.centroid.y - 550))[0];
    const naturalScreen = await page.locator(`[data-cell="${nextCell.id}"]`).evaluate((el, point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(el.getScreenCTM());
      return { x: screen.x, y: screen.y };
    }, nextCell.centroid);
    await page.mouse.click(naturalScreen.x, naturalScreen.y);
    assert.equal((await snapshot(page)).selection, await page.locator(`[data-cell="${nextCell.id}"]`).getAttribute('points'));
    if (candidateCount) assert.equal(await page.locator('.comparison-controls strong').textContent(), candidateCount);
    // Zoom and drag, then prove switching does not reset the transformed view.
    await page.mouse.move(900, 500); await page.mouse.wheel(0, -250); await page.waitForTimeout(100);
    await page.mouse.move(950, 550); await page.mouse.down(); await page.mouse.move(1020, 590, { steps: 5 }); await page.mouse.up();
    const moved = await snapshot(page);
    assert.notEqual(moved.camera, before.camera);
    await style(page, '经典地块'); await style(page, '自然地形');
    assert.deepEqual(await snapshot(page), moved);
    // Natural SVG rivers, then original GPU renderer, including rapid teardown.
    await page.keyboard.press('r');
    assert.equal(await page.locator('.map-gpu-canvas').count(), 0);
    assert.notEqual(await page.locator('.water-network').getAttribute('display'), 'none');
    assert.equal(await page.locator('#river-land-clip path').getAttribute('d'), data.map.environment.natural_surface.land_path);
    await style(page, '经典地块');
    await page.waitForFunction(() => ['gpu', 'fallback'].includes(document.querySelector('.map-gpu-layer').dataset.riverRenderer));
    const classicRiverRenderer = await page.locator('.map-gpu-layer').getAttribute('data-river-renderer');
    for (let i = 0; i < 3; i++) { await style(page, '自然地形'); await style(page, '经典地块'); }
    await style(page, '自然地形');
    await page.waitForFunction(() => !document.querySelector('.map-gpu-canvas'));
    assert.deepEqual(await snapshot(page), moved);
    // Analytical layers must remain honest cell aggregates; retain preference/month.
    await page.keyboard.press('3'); await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.map-stage[data-layer="temperature"][data-map-style="classic"]');
    const month = await page.locator('.month-chip[aria-checked="true"]').innerText();
    await style(page, '经典地块'); await style(page, '自然地形');
    assert.equal(await page.locator('.month-chip[aria-checked="true"]').innerText(), month);
    assert.equal(await page.locator('.map-stage').getAttribute('data-layer'), 'temperature');
    await page.keyboard.press('1');
    await page.waitForSelector('.world-svg[data-map-style="natural"]');
    assert.deepEqual(await snapshot(page), moved);
    await page.locator('.theme-picker select').selectOption('dark');
    assert.deepEqual(await snapshot(page), moved);
    if (count === 100) {
      await page.keyboard.press('Home');
      await screenshot(page, 'natural-dark-100');
    }
    await page.locator('.theme-picker select').selectOption('light');
    assert.equal(requests(), 1, 'presentation changes must not generate another world');
    if (count === 500) {
      await page.keyboard.press('[');
      const response = page.waitForResponse(response => response.url().endsWith('/api/maps/generate') && response.status() === 200);
      await page.locator('#generate').click();
      await response; await ready(page, count);
      await page.waitForSelector('.world-svg[data-map-style="natural"]');
      assert.equal(requests(), 2);
    }
    report.cases.push({ count, generationMs: data.meta.generation_ms, fingerprint: data.map.environment.fingerprint,
      naturalSurfaceSha256: thisDigest, classicRiverRenderer,
      passed: ['classic click', 'natural click', ...(count === 100 ? ['candidate list'] : []), 'minimap', 'camera', 'selection', 'pan/zoom', 'river lifecycle', 'month', 'theme', 'thematic fallback', 'no regeneration', ...(count === 500 ? ['regeneration'] : [])] });
    await context.close();
  }
  const mobile = await open(100, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await style(mobile.page, '自然地形');
  await mobile.page.waitForSelector('.world-svg[data-map-style="natural"]');
  assert.ok(await mobile.page.getByRole('button', { name: '经典地块', exact: true }).isVisible());
  assert.ok(await mobile.page.getByRole('button', { name: '自然地形', exact: true }).isVisible());
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot(mobile.page, 'natural-mobile-100');
  report.cases.push({ viewport: '390x844', dpr: 2, passed: ['natural view', 'switch visible', 'no horizontal overflow'] });
  await mobile.context.close();
  const legacy = await open(100, {}, true);
  await style(legacy.page, '自然地形');
  assert.equal(await legacy.page.locator('.world-svg').getAttribute('data-map-style'), 'classic');
  assert.ok((await legacy.page.locator('.map-style-note').innerText()).includes('回退'));
  report.cases.push({ legacy: true, passed: ['missing surface falls back without crashing'] });
  await legacy.context.close();
  assert.deepEqual(report.errors, []);
  await writeFile(join(out, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await screenshot(currentPage, 'failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
