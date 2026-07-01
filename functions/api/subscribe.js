// Cloudflare Pages Function — POST /api/subscribe
// Writes a pending row to book_waitlist, then adds the contact to Brevo directly
// (no double opt-in) and marks the row confirmed on success.
//
// Env (Pages → Settings → Environment variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   server-side only — bypasses RLS for upsert/config/webhook
//   BREVO_API_KEY               server-side only — never exposed client-side
// (Falls back to SUPABASE_ANON_KEY if the service-role key is absent, but the
//  webhook + config lookup need the service-role key.)
//
// Schema + seed config: see /db/brevo-doi.sql
export async function onRequestPost({ request, env }) {
  try {
    const { email, source: rawSource } = await request.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'invalid email' }, 400);
    }
    const source = rawSource || 'md';
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

    // 1) If this (email, source) is already confirmed, never downgrade it and
    //    skip the Brevo call — just succeed.
    try {
      const g = await sb(
        `book_waitlist?email=eq.${encodeURIComponent(email)}` +
        `&source=eq.${encodeURIComponent(source)}&select=status&limit=1`
      );
      if (g.ok) {
        const existing = (await g.json())[0];
        if (existing && existing.status === 'confirmed') return json({ ok: true }, 200);
      }
    } catch (_) { /* lookup failed → fall through and treat as new */ }

    // 2) Upsert the signup as pending (new row, or refresh an existing pending one).
    const up = await sb('book_waitlist?on_conflict=email,source', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email, source, status: 'pending' })
    });
    if (!up.ok && up.status !== 409) return json({ error: 'db' }, 500);

    // 3) Look up the Brevo list for this source.
    let cfg = null;
    try {
      const c = await sb(
        `waitlists?source=eq.${encodeURIComponent(source)}&select=brevo_list_id&limit=1`
      );
      if (c.ok) cfg = (await c.json())[0] || null;
    } catch (_) { /* no config → skip Brevo, still succeed */ }

    // 4) Add the contact to Brevo directly. On success — or if the contact already
    //    exists (400 duplicate_parameter) — mark the row confirmed. Any failure keeps
    //    it pending and still returns success — never lose a signup.
    if (cfg && env.BREVO_API_KEY) {
      try {
        const resp = await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            listIds: [cfg.brevo_list_id],
            updateEnabled: true,
            attributes: { SOURCE: source }
          })
        });
        const body = await resp.text();
        const added = resp.ok || (resp.status === 400 && /duplicate_parameter/.test(body));
        if (added) {
          await sb(
            `book_waitlist?email=eq.${encodeURIComponent(email)}` +
            `&source=eq.${encodeURIComponent(source)}`,
            {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() })
            }
          );
        }
      } catch (_) { /* keep pending; succeed anyway */ }
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
}

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s,
  headers: { 'Content-Type': 'application/json' }
});
