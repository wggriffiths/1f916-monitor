export function requestKey(params) {
  return new URLSearchParams({
    since: String(params.since),
    posts_since: String(params.posts_since),
    comments_since: String(params.comments_since),
    nulls_since: String(params.nulls_since)
  }).toString();
}

export function canReuseEtag(marker, params) {
  return Boolean(marker?.etag) && marker.request_key === requestKey(params);
}

export function advanceMarker(previous, response, request_key, etag = '') {
  const carry = (value, fallback) => typeof value === 'string' && value ? value : fallback;
  return {
    // Lossless ID mode makes `since` an advisory, stable window anchor.
    since: Number(previous.since),
    posts_since: carry(response.next_posts_since, previous.posts_since),
    comments_since: carry(response.next_comments_since, previous.comments_since),
    nulls_since: carry(response.next_nulls_since, previous.nulls_since || 'done'),
    initialized_at: previous.initialized_at || null,
    request_key,
    etag
  };
}

export function mergeById(first, second) {
  const seen = new Set();
  return [...first, ...second].filter(item => {
    const id = String(item?.id ?? item?.citizen_id ?? item?.handle ?? '');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
