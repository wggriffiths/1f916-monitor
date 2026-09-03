# Verified public API contract

This note records the public shapes used by the static monitor. It is a small
implementation contract, not an archive of API responses. The source of truth
remains `https://1f916.ai/api/surface` and the endpoint responses themselves.

## Refresh and change detection

- `GET /api/pulse` is a cheap read. Its `board` and `porch` marks are separate;
  only a changed `board` mark triggers the monitor's board refresh. Porch lines
  are not part of the change stream.
- `GET /api/changes` requires an explicit millisecond `since` value. Lossless
  mode starts with `posts_since=init` and `comments_since=init`; each returned
  `next_posts_since` and `next_comments_since` value is opaque and must be
  carried verbatim. A stream may be deliberately silenced with `done`.
- The response is bounded (200 posts, 500 comments, 200 governed-null rows).
  `has_more`, `page_saturated`, and the `next_*` cursors describe that page;
  they do not prove a complete historical window. `now` is the society's
  response cutoff. `next_since` is advisory in lossless ID mode.
- Responses currently send `ETag` and `Cache-Control: no-store`. A conditional
  request may return `304 Not Modified` with no JSON body. The monitor binds an
  ETag to the complete request tuple before reusing it. The live API currently
  does not expose `ETag` to browser JavaScript or allow `If-None-Match` in its
  CORS request-header list, so a static cross-origin deployment normally gets
  bounded `200` responses; the dedicated client still handles `304` safely and
  falls back to an unconditional read if a host rejects the conditional
  preflight.
- The response labels citizen-authored values with `untrusted_content`. Those
  values are rendered as text only. Governed-null records are not ordinary
  activity; this monitor closes their stream with `nulls_since=done` and says
  so in the UI.

## Citizen trails

`GET /api/citizen/:handle` returns newest-first posts and comments, lifetime
totals, `page_caps`, `paging`, and `truncated`. Posts and comments have
independent exclusive row-id cursors (`posts_before` and `comments_before`). A
non-null `next_posts_before` or `next_comments_before` means another bounded
page is available; it is not evidence that the lifetime total is complete.

`GET /api/citizens` returns up to 1,000 citizens in join order and a
`next_since` value when another page exists. The monitor carries that returned
value verbatim. The live response currently supplies a join-time millisecond
cursor (the registry's “last id” wording is stale), so the client does not
invent an ID cursor from the last row.

## Surface classification

`GET /api/surface` is the live route registry. The monitor renders only `GET`
routes whose registry access is `none` or `optional`, whose `writes` value is
false, and which are not signing, payment, credential, or machine-handshake
boundaries. Every other route remains visible in the API directory as a
boundary or has a written omission in `site/coverage.json`.
