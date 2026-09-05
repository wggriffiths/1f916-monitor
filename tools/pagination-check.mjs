import assert from 'node:assert/strict';
import {fixtures} from './visual-fixtures.mjs';

export async function checkPagination(browser, base) {
  const page = await browser.newPage();
  const posts = Array.from({length: 65}, (_, i) => ({...fixtures['/api/front'].posts[0], id: 1000+i, title: `Archive record ${i}`}));
  const requests = []; let fail = true;
  await page.route('https://1f916.ai/**', route => {
    const url = new URL(route.request().url());
    let data = structuredClone(fixtures[url.pathname] || {});
    if (url.pathname === '/api/new') {
      requests.push(url);
      if (url.searchParams.has('before') && fail) return route.fulfill({status:503, body:'{}'});
      data = url.searchParams.has('before')
        ? {posts: posts.slice(29,60), has_more:false}
        : {posts:posts.slice(0,30), has_more:true, next_before:'opaque:cursor', snapshot_id:1234, pin_snapshot:'17,18'};
    }
    if (url.pathname === '/api/front') data = {posts, limit:100};
    return route.fulfill({contentType:'application/json', body:JSON.stringify(data)});
  });
  await page.goto(`${base}/#new`);
  const more = page.getByRole('button', {name:'Continue to older posts', exact:true});
  await more.waitFor();
  assert.equal(await page.locator('.post-card:visible').count(),30);
  await page.locator('.load-more-button:visible').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/pagination-desktop.png'});
  await more.click();
  await page.locator('.load-more-error').waitFor();
  assert.equal(await page.locator('.post-card:visible').count(),30);
  fail = false;
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('.post-card:not([hidden])').length === 60);
  assert.equal(await page.locator('.post-card').count(),60,'Cursor overlap is deduplicated');
  const query = requests.at(-1).searchParams;
  assert.equal(query.get('before'),'opaque:cursor');
  assert.equal(query.get('snapshot_id'),'1234');
  assert.equal(query.get('pin_snapshot'),'17,18');
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('.post-card:visible').count(),60,'Background updates retain the expanded snapshot');
  await page.evaluate(() => switchView('front'));
  await page.getByRole('button', {name:'Continue with 30 more posts'}).waitFor();
  assert.equal(await page.locator('.post-card:visible').count(),30);
  await page.getByRole('button', {name:'Continue with 30 more posts'}).click();
  assert.equal(await page.locator('.post-card:visible').count(),60);
  await page.getByRole('button', {name:'Continue with 5 more posts'}).click();
  assert.equal(await page.locator('.post-card:visible').count(),65);
  assert.equal(await page.locator('.load-more-button:visible').count(),0);
  for (const kind of ['tags', 'docket', 'official', 'events', 'porch']) {
    await page.evaluate(kind => {
      currentView = kind;
      const rows = Array.from({length:65}, (_,id) => ({id, tag:`tag-${id}`, title:`Record ${id}`, name:`Window ${id}`, body:`Line ${id}`, kind:'citizen_joined', lane:'work'}));
      const content = document.getElementById('content');
      if (kind === 'tags') renderTags(content, {tags:rows});
      if (kind === 'docket') renderDocket(content, {docket:rows});
      if (kind === 'official') renderOfficial(content, {known_windows:rows});
      if (kind === 'events') { cache.events={events:rows}; renderEvents(content); }
      if (kind === 'porch') renderPorch(content, {day:'2026-09-05', lines:rows});
    }, kind);
    await page.getByRole('button', {name:'Continue with 30 more records'}).click();
    await page.getByRole('button', {name:'Continue with 5 more records'}).click();
    assert.equal(await page.locator('.load-more-button:visible').count(),0,kind);
  }
  await page.close();
  console.log('Pagination checks passed: retry, opaque snapshot cursors, deduplication, retained records and local batches.');
}
