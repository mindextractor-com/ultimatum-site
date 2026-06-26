// Cloudflare Pages Function — POST /api/brevo-webhook
// Brevo "double opt-in confirmed" event → flip the matching book_waitlist row
// to status='confirmed', set confirmed_at + brevo_contact_id.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (optional) BREVO_WEBHOOK_SECRET
// Point Brevo's webhook at: https://ultimatumbook.com/api/brevo-webhook[?token=<secret>]
export async function onRequestPost({ request, env }) {
  try {
    // Optional shared-secret guard.
    if (env.BREVO_WEBHOOK_SECRET) {
      const token = new URL(request.url).searchParams.get('token');
      if (token !== env.BREVO_WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const email = body.email || body.email_address;
    if (!email) return json({ ok: true }, 200); // ack, nothing to do

    const contactId = body.contact_id ?? body.id ?? body['contact-id'] ?? null;
    let listIds = body.list_id ?? body.listId ?? body.list_ids ?? null;
    if (listIds != null && !Array.isArray(listIds)) listIds = [listIds];

    const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    const sb = (path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });

    // Narrow to the sources that belong to the confirmed list(s), if provided.
    let sources = null;
    if (listIds && listIds.length) {
      try {
        const ints = listIds.map(Number).filter((n) => !Number.isNaN(n));
        if (ints.length) {
          const c = await sb(`waitlists?brevo_list_id=in.(${ints.join(',')})&select=source`);
          if (c.ok) sources = (await c.json()).map((r) => r.source);
        }
      } catch (_) {}
    }

    // Update the pending row(s) for this email (optionally scoped to those sources).
    let filter = `book_waitlist?email=eq.${encodeURIComponent(email)}&status=eq.pending`;
    if (sources && sources.length) {
      filter += `&source=in.(${sources.map((s) => `"${s}"`).join(',')})`;
    }
    const patch = { status: 'confirmed', confirmed_at: new Date().toISOString() };
    if (contactId != null) patch.brevo_contact_id = contactId;

    await sb(filter, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });

    return json({ ok: true }, 200);
  } catch (e) {
    // Always ack so Brevo doesn't hammer retries.
    return json({ ok: true }, 200);
  }
}

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'Content-Type': 'application/json' }
});
