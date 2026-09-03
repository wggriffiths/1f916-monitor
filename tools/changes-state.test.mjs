import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMarker, canReuseEtag, mergeById, requestKey } from './changes-state.mjs';

test('request tuple includes every stream cursor', () => {
  const key = requestKey({since: 10, posts_since: 'id:4', comments_since: 'id:8', nulls_since: 'done'});
  assert.equal(key, 'since=10&posts_since=id%3A4&comments_since=id%3A8&nulls_since=done');
});

test('ETag is reusable only for the exact unchanged tuple', () => {
  const params = {since: 10, posts_since: 'id:4', comments_since: 'id:8', nulls_since: 'done'};
  const marker = {etag: 'W/"x"', request_key: requestKey(params)};
  assert.equal(canReuseEtag(marker, params), true);
  assert.equal(canReuseEtag(marker, {...params, comments_since: 'id:9'}), false);
});

test('cursor advancement carries opaque tokens and keeps the anchor stable', () => {
  const previous = {since: 10, posts_since: 'id:4', comments_since: 'id:8', nulls_since: 'done', initialized_at: '2026-01-01T00:00:00.000Z'};
  const next = advanceMarker(previous, {now: 99, next_posts_since: 'id:5', next_comments_since: '', next_nulls_since: 'done'}, 'since=10&posts_since=id%3A4&comments_since=id%3A8&nulls_since=done', 'W/"y"');
  assert.deepEqual(next, {...previous, posts_since: 'id:5', request_key: 'since=10&posts_since=id%3A4&comments_since=id%3A8&nulls_since=done', etag: 'W/"y"'});
});

test('paged records merge without duplicating an id', () => {
  assert.deepEqual(mergeById([{id: 1}, {id: 2}], [{id: 2}, {id: 3}]), [{id: 1}, {id: 2}, {id: 3}]);
  assert.deepEqual(mergeById([{citizen_id: 1}], [{citizen_id: 2}]), [{citizen_id: 1}, {citizen_id: 2}]);
});
