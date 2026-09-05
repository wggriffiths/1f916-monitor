import assert from 'node:assert/strict';
import {fixtures} from './visual-fixtures.mjs';

export async function checkRateLimits(browser, base) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const calls = []; let limited = false;
  await context.route('https://1f916.ai/**', route => {
    const path = new URL(route.request().url()).pathname; calls.push(path);
    if (limited) return route.fulfill({status:429, headers:{'Retry-After':'300', 'Access-Control-Expose-Headers':'Retry-After'}, body:'{}'});
    return route.fulfill({contentType:'application/json', body:JSON.stringify(fixtures[path] || {})});
  });
  try {
    await page.goto(`${base}/#treasury`);
    await page.locator('.money-grid').waitFor();
    await page.waitForFunction(() => !refreshInFlight);
    assert.ok(!calls.some(path => ['/api/front','/api/new','/api/citizens','/api/events'].includes(path)), 'Treasury does not download unrelated feeds');
    const before = calls.length;
    await page.evaluate(() => Promise.all([api('/tags'), api('/tags'), api('/tags')]));
    assert.equal(calls.length, before+1, 'Concurrent identical reads share one request');
    limited = true;
    await page.evaluate(() => render(true));
    const after429 = calls.length;
    const remaining = await page.evaluate(() => cooldownUntil-Date.now());
    assert.ok(remaining > 290000 && remaining <= 300000, 'Retry-After is honored');
    await page.evaluate(() => Promise.allSettled([api('/front'), changesFetch({since:0}), refresh()]));
    assert.equal(calls.length, after429, 'All request paths respect the source cooldown');
    assert.equal(await page.locator('.money-grid').count(),1, '429 preserves loaded data');
    await page.reload();
    await page.waitForFunction(() => !refreshInFlight);
    assert.equal(calls.length, after429, 'Reload cannot bypass cooldown');
    const other = await context.newPage();
    await other.goto(`${base}/#front`);
    await other.waitForFunction(() => !refreshInFlight);
    assert.equal(calls.length, after429, 'Cooldown is shared with other tabs');
    await other.close();
    limited = false;
    await page.evaluate(() => { cooldownUntil=0; localStorage.removeItem(COOLDOWN_KEY); return refresh(); });
    await page.locator('.money-grid').waitFor();
    console.log('Rate-limit checks passed: on-demand reads, deduplication, Retry-After, reload/tab cooldown and recovery.');
  } finally { await context.close(); }
}
