// Cloudflare Pages Function — GET /api/editions
// Price and «Каркас дня» Про months of all four editions, from the app's price
// preview (book-order GET ?edition=), so the site never hardcodes the bonus.
// One call for the page instead of four to the app; cached at the edge 10 min.
// → { ok, editions: { text: { price_rub, amount_rub, pro_months }, … } }
import { bookOrder, EDITIONS, json } from '../../delivery/app.js';

const TTL = 600;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/editions', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const rows = await Promise.all(EDITIONS.map((edition) => bookOrder(env, { query: { edition } })));
  const editions = {};
  rows.forEach((r, i) => {
    if (r.body.ok) {
      const { price_rub, amount_rub, pro_months } = r.body;
      editions[EDITIONS[i]] = { price_rub, amount_rub, pro_months };
    }
  });
  const complete = Object.keys(editions).length === EDITIONS.length;
  const resp = new Response(JSON.stringify({ ok: complete, editions }), {
    status: complete ? 200 : 502,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': complete ? `public, max-age=${TTL}` : 'no-store' }
  });
  if (complete) waitUntil(cache.put(key, resp.clone()));
  return resp;
}
