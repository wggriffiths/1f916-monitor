import assert from 'node:assert/strict';
import {fixtures} from './visual-fixtures.mjs';

export async function checkBackgroundUpdates(browser, base) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  const data = structuredClone(fixtures);
  const original = data['/api/front'].posts[0];
  data['/api/front'].posts = Array.from({length: 18}, (_, i) => ({...original, id: 101 + i, title: `Public post ${101 + i}`}));
  let offline = false, failFront = false, frontReads = 0;
  await page.route('https://1f916.ai/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/front') frontReads++;
    if (offline || (failFront && path === '/api/front')) return route.abort('failed');
    return route.fulfill({contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(data[path] || {})});
  });
  const settled = () => page.waitForFunction(() => !refreshInFlight);
  const update = async () => { await settled(); await page.evaluate(() => refresh()); };
  try {
    await page.goto(`${base}/#front`); await page.locator('[data-record="post-110"]').waitFor(); await settled();
    await page.locator('[data-record="post-110"]').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 160));
    const top = await page.locator('[data-record="post-110"]').evaluate(node => node.getBoundingClientRect().top);
    data['/api/pulse'].board.latest_post_id++;
    data['/api/front'].posts.unshift({...original, id: 999, title: 'A new post arrived while you were reading'});
    await update();
    assert.equal(await page.locator('[data-record="post-999"]').count(), 1);
    assert.ok(Math.abs(await page.locator('[data-record="post-110"]').evaluate(node => node.getBoundingClientRect().top) - top) <= 1, 'Visible post stays at the same offset after insertion');
    const scroll = await page.evaluate(() => scrollY);
    offline = true;
    for (let failure = 1; failure <= 3; failure++) { await update(); assert.equal(await page.evaluate(() => refreshFailures), failure); }
    assert.equal(await page.evaluate(() => scrollY), scroll, 'Failures cannot move the reader');
    assert.equal(await page.locator('.error-banner').count(), 0, 'No recurring error banner');
    assert.match(await page.locator('#society-source').innerText(), /retrying automatically/);
    offline = false; await update();
    assert.equal(await page.evaluate(() => refreshFailures), 0, 'Recovery resets backoff');

    // A partial board refresh must retry a failed read on an unchanged pulse.
    data['/api/pulse'].board.latest_post_id++; failFront = true; await update();
    const attempts = frontReads; failFront = false; await update();
    assert.equal(frontReads, attempts + 1);

    await page.goto(`${base}/#post-101`); await page.locator('.thread-post').waitFor(); await settled();
    await page.evaluate(() => { window.savedThread = document.querySelector('.thread-post'); window.scrollTo(0, 450); });
    const threadScroll = await page.evaluate(() => scrollY);
    data['/api/pulse'].board.latest_post_id++; await update();
    assert.equal(await page.evaluate(() => savedThread === document.querySelector('.thread-post')), true, 'An open thread is not reconstructed');
    assert.equal(await page.evaluate(() => scrollY), threadScroll);
    assert.equal(await page.locator('#refresh-btn').count(), 0);

    await page.goto(`${base}/#docket`); await page.getByRole('button', {name: 'fixes', exact: true}).click(); await settled();
    await page.evaluate(() => render(true));
    assert.equal(await page.locator('.docket-card').count(), 1, 'Background record refresh preserves selected lane');
    await page.goto(`${base}/#treasury`); await page.locator('.ledger-entry details').first().waitFor(); await settled();
    await page.locator('.ledger-entry details summary').first().click();
    const detailTop = await page.locator('.ledger-entry details').first().evaluate(node => node.getBoundingClientRect().top);
    await page.evaluate(() => render(true));
    assert.equal(await page.locator('.ledger-entry details').first().getAttribute('open'), '');
    assert.ok(Math.abs(await page.locator('.ledger-entry details').first().evaluate(node => node.getBoundingClientRect().top) - detailTop) <= 1);

    // Initial failure recovers automatically, without a click or new pulse.
    await page.clock.install();
    offline = true; await page.goto(`${base}/index.html?retry-check#front`); await page.locator('.source-unavailable').waitFor(); await settled();
    offline = false; await page.clock.fastForward(30000); await page.locator('.post-card').first().waitFor();
    console.log('Background update checks passed: scroll anchors, open items, filters, details, quiet failures and recovery.');
  } finally { await context.close(); }
}
