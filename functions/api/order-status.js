// Cloudflare Pages Function — GET /api/order-status?order=<uuid>
// For /ru/payment/success: the order id comes from Robokassa's Shp_order (never
// InvId). Answers only the status and a masked e-mail — never the ПРО code,
// links or the full address.
import { bookOrder, UUID_RE, json } from '../../delivery/app.js';

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('order') || '';
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'not_found' }, 404);
  const r = await bookOrder(env, { query: { order_id: id } });
  if (!r.body.ok) return json({ ok: false, error: r.body.error || 'server_error' }, r.status);
  return json({ ok: true, status: r.body.status, email: maskEmail(r.body.email || '') });
}

// ivanov.kos@gmail.com → iv***@gmail.com (length hidden)
export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const name = email.slice(0, at);
  const keep = name.length > 3 ? 2 : 1;
  return name.slice(0, keep) + '***' + email.slice(at);
}
