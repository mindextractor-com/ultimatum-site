// Cloudflare Pages Function — POST /api/resend {email}   (page /ru/links)
// Asks the app to e-mail fresh links for the paid orders of this address
// (book-order {action:"resend"}; the app calls /api/deliver with "reissue").
// The site keeps no orders: it does not know, and never tells, whether an
// order exists — the answer is always the same.
// Limit: one request per e-mail and one per IP per 15 minutes; over the limit
// the request is silently dropped (same answer). Marks live in R2 under
// _delivery/ratelimit/ (a bucket lifecycle rule deletes them after a day).
import { bookOrder, EMAIL_RE, json } from '../../delivery/app.js';

const WINDOW_MS = 15 * 60 * 1000;
const PREFIX = '_delivery/ratelimit/resend/';
const SAME_ANSWER = { ok: true };

export async function onRequestPost({ request, env, waitUntil }) {
  let b;
  try { b = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_request' }, 400); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: 'invalid_email' }, 422);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keys = [PREFIX + 'email-' + await sha256(email), PREFIX + 'ip-' + await sha256(ip)];

  // Do the work after answering, so the response looks the same either way.
  waitUntil((async () => {
    const heads = await Promise.all(keys.map((k) => env.FILES.head(k)));
    if (heads.some((h) => h && Date.now() - h.uploaded.getTime() < WINDOW_MS)) return;
    await Promise.all(keys.map((k) => env.FILES.put(k, '1')));
    await bookOrder(env, { method: 'POST', body: { action: 'resend', email } });
  })().catch(() => {}));

  return json(SAME_ANSWER);
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
