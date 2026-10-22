// Cloudflare Pages Function — POST /api/deliver
// Called by the checkout after payment. Issues 7-day download links for the
// edition's files, emails them with the «Каркас дня» Про code via Brevo, then
// adds the buyer to the Brevo list «Покупатели книги» (BUYER, PRO_UNTIL) and,
// only if they ticked «Хочу получать рассылку автора» at checkout (stored by
// /api/checkout under the order_id), to «Все контакты» with MARKETING_OK.
//
// Header X-Delivery-Secret must equal the secret BOOK_DELIVERY_SECRET.
// Body:
//   { order_id, edition, email, code, pro_months }   deliver
//   { order_id, action: "reissue" }   revoke the old links, email fresh ones
//     ("resend" is the same; with the five fields it also works for an order
//      the site has no record of — then it is a first delivery)
//   { order_id, action: "revoke" }    revoke the links, send nothing
// edition: text | audio | text_audio | text_audio_pro ("text+audio" works too).
//
// Idempotent per order_id: a repeated deliver returns the first result (200)
// without sending again. 201 is returned only after Brevo accepted the email;
// if Brevo refuses, the links are revoked and the call can simply be retried.
//
// Env: BOOK_DELIVERY_SECRET, BREVO_API_KEY (secrets); DELIVERY_SENDER_EMAIL,
// BREVO_BUYERS_LIST_ID, BREVO_MARKETING_LIST_ID, DOWNLOAD_BASE (vars); FILES (R2).
import { bookOrder } from '../../delivery/app.js';
import {
  LINK_TTL_DAYS, editionId, getEdition, getFile, getOrder, putOrder, deleteOrder,
  issueTokens, revokeTokens, buildEmail, sendEmail, upsertBuyer, addMonths, getConsent
} from '../../delivery/lib.js';

const PENDING_LOCK_MS = 2 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.BOOK_DELIVERY_SECRET || !env.BREVO_API_KEY || !env.FILES) {
    return json({ error: 'not configured' }, 500);
  }
  if (!safeEqual(request.headers.get('X-Delivery-Secret') || '', env.BOOK_DELIVERY_SECRET)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'invalid json' }, 400); }

  const orderId = String(body.order_id ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(orderId)) return json({ error: 'invalid order_id' }, 400);

  const existing = await getOrder(env, orderId);
  const action = body.action === 'resend' ? 'reissue' : body.action;
  const delivered = existing && ['sent', 'revoked'].includes(existing.status);

  if (action === 'revoke' || (action === 'reissue' && (delivered || body.edition == null))) {
    if (!delivered) return json({ error: 'order not delivered' }, 404);
    await revokeTokens(env, existing.tokens);
    if (action === 'revoke') {
      await putOrder(env, { ...existing, tokens: [], status: 'revoked', revoked_at: new Date().toISOString() });
      return json({ ok: true, order_id: orderId, status: 'revoked' }, 200);
    }
    return deliver(request, env, { ...existing, reissue: true }, existing);
  }
  // reissue with full fields for an order the site has no record of → a first delivery
  if (action && action !== 'reissue') return json({ error: 'unknown action' }, 400);

  const edition = editionId(body.edition);
  const email = String(body.email ?? '').trim();
  const code = body.code == null ? '' : String(body.code).trim();
  const proMonths = Number(body.pro_months ?? 0);
  if (!getEdition(edition)) return json({ error: 'unknown edition' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid email' }, 400);
  if (code && !(Number.isInteger(proMonths) && proMonths > 0 && proMonths <= 120)) {
    return json({ error: 'invalid pro_months' }, 400);
  }

  if (existing) {
    const same = existing.edition === edition && existing.email.toLowerCase() === email.toLowerCase() &&
      existing.code === code;
    if (!same) return json({ error: 'order_id already used with different data' }, 409);
    if (existing.status === 'sent' || existing.status === 'revoked') {
      return json({ ok: true, order_id: orderId, status: 'already_sent', message_id: existing.message_id,
        expires_at: existing.expires_at }, 200);
    }
    if (existing.status === 'pending' && Date.now() - Date.parse(existing.started_at) < PENDING_LOCK_MS) {
      return json({ error: 'in progress, retry later' }, 409);
    }
    // a stale pending record: the previous attempt died mid-way — start over
    await revokeTokens(env, existing.tokens);
  }

  return deliver(request, env, {
    order_id: orderId, edition, email, code, pro_months: code ? proMonths : 0,
    inv_id: /^\d{1,12}$/.test(String(body.inv_id ?? '')) ? Number(body.inv_id) : null,
    created_at: new Date().toISOString()
  }, existing);
}

async function deliver(request, env, order, previous) {
  const edition = getEdition(order.edition);
  const now = new Date();
  const expiresAt = endOfMoscowDay(now.getTime() + LINK_TTL_DAYS * 86400000);
  if (!order.inv_id) order.inv_id = await findInvId(env, order.order_id);

  const tokens = await issueTokens(env, order.order_id, edition, expiresAt);
  const pending = { ...order, status: 'pending', started_at: now.toISOString(), expires_at: expiresAt, tokens };
  delete pending.reissue;
  await putOrder(env, pending);

  const base = (env.DOWNLOAD_BASE || new URL(request.url).origin).replace(/\/$/, '');
  const links = [];
  for (const { token, file } of tokens) {
    const f = getFile(file);
    const head = await env.FILES.head(f.key);
    if (!head) return fail(env, pending, previous, 500, `file missing: ${f.key}`);
    links.push({ url: `${base}/download/${token}`, title: f.title, hint: f.hint, size: head.size });
  }

  const mail = buildEmail({ edition, links, code: order.code, proMonths: order.pro_months,
    expiresAt, invId: order.inv_id, reissue: order.reissue });
  let sent;
  try {
    sent = await sendEmail(env, { to: order.email, ...mail, orderId: order.order_id });
  } catch (e) {
    sent = { ok: false, status: 0, error: String(e) };
  }
  if (!sent.ok) return fail(env, pending, previous, 502, `email not accepted: ${sent.status} ${sent.error}`);

  const done = { ...pending, status: 'sent', sent_at: new Date().toISOString(), message_id: sent.messageId };
  if (order.reissue) done.reissued_at = done.sent_at;
  await putOrder(env, done);

  // The email is out — a contact failure must not turn this into an error
  // (a retry would be a no-op anyway). It is recorded on the order instead.
  let contact = false;
  if (env.BREVO_BUYERS_LIST_ID) {
    try {
      const consent = await getConsent(env, order.order_id);
      contact = await upsertBuyer(env, {
        email: order.email, edition: order.edition,
        marketingAt: consent && consent.marketing ? consent.marketing_at : null,
        proUntil: order.pro_months ? addMonths(order.created_at, order.pro_months) : null
      });
    } catch (_) { /* recorded below */ }
  }
  if (!contact) await putOrder(env, { ...done, contact_error: true });

  return json({ ok: true, order_id: order.order_id, status: order.reissue ? 'reissued' : 'sent',
    message_id: sent.messageId, expires_at: expiresAt, links: links.length, contact }, 201);
}

// Undo this attempt: drop the new links and put the order back as it was.
async function fail(env, pending, previous, status, error) {
  await revokeTokens(env, pending.tokens);
  if (previous && previous.status === 'sent') await putOrder(env, { ...previous, tokens: [], status: 'revoked' });
  else await deleteOrder(env, pending.order_id);
  return json({ error }, status);
}

// Links work through the whole 7th day, Moscow time — «до 29 октября включительно».
function endOfMoscowDay(ms) {
  const day = new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
  return `${day}T20:59:59.999Z`; // 23:59:59.999 MSK (UTC+3, no DST)
}

// The buyer sees the short order number (inv_id, as on the receipt), never the
// uuid. The app's delivery body has no inv_id, so ask the app; none → no line.
async function findInvId(env, orderId) {
  try {
    const r = await bookOrder(env, { query: { order_id: orderId } });
    return r.body.ok && r.body.inv_id ? r.body.inv_id : null;
  } catch (_) { return null; }
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'Content-Type': 'application/json' }
});
