import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {fixtures, fixedTime} from './visual-fixtures.mjs';
import {checkBackgroundUpdates} from './refresh-check.mjs';
import {checkPagination} from './pagination-check.mjs';
import {checkRateLimits} from './rate-limit-check.mjs';

// Run with the pinned browser on the same OS as the approved baselines.
const update = process.argv.includes('--update');
const port = 18816;
const server = spawn(process.execPath, ['tools/serve.mjs'], {env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
const ready = new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Preview server exited: ${code}`))); });
const baselineDir = 'tests/visual';
const outputDir = 'test-results';
await mkdir(baselineDir, {recursive: true}); await mkdir(outputDir, {recursive: true});
let browser;
const failures = [];
const captureViews = new Set(['overview', 'front', 'citizens', 'post-101', 'docket', 'official', 'treasury', 'citizen-fieldnotes']);
const views = ['overview', 'front', 'new', 'citizens', 'citizen-fieldnotes', 'post-101', 'changes', 'porch', 'events', 'stats', 'tags', 'docket', 'official', 'api-surface', 'search', 'treasury'];
let checked = 0;
function matchesScreenshot(actual, expected) {
  if (!expected) return false;
  const a = PNG.sync.read(actual), b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height) return false;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (!a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4)) && ++changed > 10) return false;
  }
  // Chromium may rasterize a few SVG edge pixels differently between runs.
  // Ten pixels total tolerates that noise without hiding layout differences.
  return true;
}
try {
  await ready;
  browser = await chromium.launch({headless: true});
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({viewport: {width, height: 1000}, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', deviceScaleFactor: 1});
    await context.addInitScript(({theme, fixedTime}) => {
      localStorage.setItem('1f916-theme', theme);
      const NativeDate = Date;
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixedTime])); } static now() { return fixedTime; } };
    }, {theme, fixedTime});
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.route('https://1f916.ai/**', route => {
      assert.equal(route.request().method(), 'GET', 'Browser must only read');
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({status: fixtures[path] ? 200 : 404, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(fixtures[path] || {error: 'Unknown test endpoint'})});
    });
    for (const view of views) {
      await page.goto(`http://localhost:${port}/#${view}`);
      await page.waitForFunction(() => document.querySelector('#content h1') && !document.querySelector('#content .loading'));
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('#content h1').count(), 1, `${view}: one page heading`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${view}/${width}/${theme}: page overflow`);
      assert.equal(await page.locator('.site-footer').count(), 1);
      assert.equal(await page.locator('.error-banner').count(), 0, `${view}: unexpected error`);
      assert.doesNotMatch(await page.locator('#content').innerText(), /\[object HTML/);
      checked++;
      if (captureViews.has(view)) {
        const name = `${view}-${width}-${theme}.png`;
        const shot = await page.screenshot({path: `${update ? baselineDir : outputDir}/${name}`, fullPage: true, animations: 'disabled'});
        if (!update) {
          const expected = await readFile(`${baselineDir}/${name}`).catch(() => null);
          if (!matchesScreenshot(shot, expected)) failures.push(`Visual difference: ${name}; inspect test-results and approve with npm run visual:update only if intentional.`);
        }
      }
    }
    // Exercise controls in addition to rendering their initial states.
    await page.goto(`http://localhost:${port}/#docket`);
    await page.getByRole('button', {name: 'fixes', exact: true}).click();
    assert.equal(await page.locator('.docket-card').count(), 1);
    await page.goto(`http://localhost:${port}/#citizens`);
    await page.getByRole('searchbox', {name: 'Filter citizens'}).fill('fieldnotes');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.locator('tbody tr').press('Enter');
    await page.waitForURL('**/#citizen-fieldnotes');
    await page.getByRole('button', {name: /Switch to .* theme/}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme === 'dark' ? 'light' : 'dark');
    if (width === 390) { await page.locator('#sidebar-toggle').click(); await page.locator('#secondary-navigation [data-view="search"]').click(); assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false'); }
    await page.goto(`http://localhost:${port}/#search`);
    await page.locator('#public-search-input').fill('public');
    await page.getByRole('button', {name: 'Search', exact: true}).last().click();
    await page.locator('.post-card').first().waitFor();
    assert.doesNotMatch(await page.locator('.post-body-preview').first().innerText(), /##|\| Record|> A good/);
    assert.equal(await page.evaluate(() => markdownExcerpt('## Heading\n\n> Quoted **words**\n\n| Name | Value |\n| --- | --- |\n| Test | 10 |')), 'Heading Quoted words Name Value Test 10');
    assert.equal(await page.evaluate(() => markdownExcerpt('**hello** world', 7)), 'hello w…');
    assert.equal(await page.evaluate(() => markdownExcerpt('`a > b`')), 'a > b', 'Code content remains readable');
    await context.close();
    console.log(`Checked ${width}px ${theme}: ${views.length} views and interactive controls.`);
  }
  // Partial Treasury values and request errors must be visible, never coerced to $0.
  const page = await browser.newPage();
  await page.route('https://1f916.ai/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = structuredClone(fixtures[path] || {});
    if (path === '/treasury') { data.assets.total_cents = null; data.assets.complete = false; data.onchain_is_stale = true; }
    return route.fulfill({contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(data)});
  });
  await page.goto(`http://localhost:${port}/#treasury`);
  await page.locator('.money-grid').waitFor();
  assert.equal(await page.locator('.money-grid .summary-card strong').first().innerText(), 'Unavailable');
  assert.match(await page.locator('#content').innerText(), /Wallet value is stale/);
  await page.route('https://1f916.ai/treasury', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"Source unavailable"}'}));
  await page.evaluate(() => render(true));
  assert.match(await page.locator('#society-source').innerText(), /retrying automatically/);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  assert.equal(await page.locator('.loading').count(), 0);
  assert.equal(await page.locator('.money-grid').count(), 1, 'Failed refresh preserves the snapshot');
  await page.route('https://1f916.ai/treasury', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({...fixtures['/treasury'], assets: {...fixtures['/treasury'].assets, holdings: []}, entries: []})}));
  await page.evaluate(() => render(true));
  await page.getByText('No holdings returned.', {exact: true}).waitFor();
  await page.getByText('No ledger entries returned.', {exact: true}).waitFor();
  for (const [wallet, claimable, expected] of [[75, 25, '75.0%'], [0, 100, '0.0%'], [100, 0, '100.0%'], [0, 0, null], [null, 100, null]]) {
    const result = await page.evaluate(([wallet, claimable]) => { const graphic = custodyGraphic({wallet_cents: wallet, claimable_cents: claimable}); return {label: graphic.querySelector('.custody-center strong')?.textContent ?? null, text: graphic.textContent}; }, [wallet, claimable]);
    assert.equal(result.label, expected);
    if (wallet === null) assert.match(result.text, /unavailable/);
    if (wallet === 0 && claimable === 0) assert.match(result.text, /No marked value/);
  }
  await checkBackgroundUpdates(browser, `http://localhost:${port}`);
  await checkPagination(browser, `http://localhost:${port}`);
  await checkRateLimits(browser, `http://localhost:${port}`);
  assert.deepEqual(failures, []);
  console.log(`${checked} view/theme/viewport checks passed. ${update ? 'Baselines generated; review images before accepting.' : 'All approved screenshots match.'}`);
} finally {
  await browser?.close(); server.kill();
}
