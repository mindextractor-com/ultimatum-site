// Cloudflare Pages Function — /api/checkout (the /ru/buy page)
//   GET  ?edition=&promo=   price preview from the app
//   POST {edition, email, promo?, accept_offer, accept_pd, marketing}
//        → creates the order in the app and returns its Robokassa payment_form.
// Both consents (offer, personal data) are required; «Хочу получать рассылку
// автора» is optional. The consents are stored under the app's order_id, and
// /api/deliver reads the marketing one after payment.
//
// Env: KD_BOOK_SITE_SECRET (secret), BOOK_ORDER_URL (optional), FILES (R2).
import { bookOrder, EDITIONS, EMAIL_RE, json } from '../../delivery/app.js';
import { putConsent } from '../../delivery/lib.js';

// Versions of the documents the buyer agreed to (their «Обновлено» dates).
const OFFER_VERSION = '2026-10-21';
const CONSENT_VERSION = '2026-10-23';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const edition = q.get('edition') || '';
  const promo = (q.get('promo') || '').trim().slice(0, 64);
  if (!EDITIONS.includes(edition)) return json({ ok: false, error: 'unknown_edition' }, 422);
  const r = await bookOrder(env, { query: { edition, promo } });
  return json(r.body, r.status);
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_request' }, 400); }

  const edition = String(b.edition || '');
  const email = String(b.email || '').trim();
  const promo = String(b.promo || '').trim().slice(0, 64);
  if (!EDITIONS.includes(edition)) return json({ ok: false, error: 'unknown_edition' }, 422);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: 'invalid_email' }, 422);
  if (b.accept_offer !== true || b.accept_pd !== true) return json({ ok: false, error: 'consent_required' }, 422);

  const r = await bookOrder(env, { method: 'POST', body: { edition, email, ...(promo ? { promo } : {}) } });
  const o = r.body;
  if (r.status !== 201 || !o.ok || !o.order_id) return json(o.ok === false ? o : { ok: false, error: 'server_error' }, r.status === 201 ? 502 : r.status);

  const now = new Date().toISOString();
  try {
    await putConsent(env, o.order_id, {
      order_id: o.order_id, email, edition,
      offer_accepted_at: now, offer_version: OFFER_VERSION,
      pd_consent_at: now, pd_consent_version: CONSENT_VERSION,
      marketing: b.marketing === true, marketing_at: b.marketing === true ? now : null
    });
  } catch (_) { /* never block the payment on this record */ }

  return json({
    ok: true, order_id: o.order_id, amount_rub: o.amount_rub, is_test: o.is_test,
    payment_form: o.payment_form || null, payment_url: o.payment_url || null
  }, 201);
}
