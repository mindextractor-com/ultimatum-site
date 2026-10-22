// Client for the «Каркас дня» app's book-order function — server side only
// (header X-Book-Secret = KD_BOOK_SITE_SECRET). Used by /api/checkout,
// /api/order-status and /api/resend.
//   POST {edition, email, promo?}        → create an order, Robokassa payment_form
//   POST {action:"resend", email}        → the app re-sends links for paid orders
//   GET  ?edition=&promo=                → price preview
//   GET  ?order_id=                      → order status (contains the ПРО code — never pass it on)
const DEFAULT_URL = 'https://jnnenorkyegdeyxgyocl.supabase.co/functions/v1/book-order';

export const BOOK_EDITIONS = ['text', 'audio', 'text_audio', 'text_audio_pro'];
// «Каркас дня» Про on its own — no files, only the code (app task T87).
export const PRO_EDITIONS = ['pro_3m', 'pro_12m'];
export const EDITIONS = [...BOOK_EDITIONS, ...PRO_EDITIONS];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves to { status, body } — body is the app's JSON ({ok:false,error} on errors).
export async function bookOrder(env, { method = 'GET', query, body } = {}) {
  if (!env.KD_BOOK_SITE_SECRET) return { status: 503, body: { ok: false, error: 'not_configured' } };
  const url = new URL(env.BOOK_ORDER_URL || DEFAULT_URL);
  for (const [k, v] of Object.entries(query || {})) if (v) url.searchParams.set(k, v);
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'X-Book-Secret': env.KD_BOOK_SITE_SECRET, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await resp.json().catch(() => ({ ok: false, error: 'server_error' }));
    return { status: resp.status, body: data };
  } catch (_) {
    return { status: 502, body: { ok: false, error: 'server_error' } };
  }
}

export const json = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
