// Cloudflare Pages Function — POST /api/subscribe
// Writes a pending row to book_waitlist, then triggers a Brevo double opt-in email.
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
    //    never re-send the DOI — just succeed.
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

    // 3) Look up the Brevo config for this source.
    let cfg = null;
    try {
      const c = await sb(
        `waitlists?source=eq.${encodeURIComponent(source)}` +
        `&select=brevo_list_id,doi_template_id,redirect_url,lang&limit=1`
      );
      if (c.ok) cfg = (await c.json())[0] || null;
      else console.log('DIAG config_lookup_error=', 'status ' + c.status);
    } catch (e) { console.log('DIAG config_lookup_error=', String(e)); }
    if (!cfg) console.log('DIAG config_empty');

    // ── TEMPORARY diagnostics (remove after debugging) ──
    console.log('DIAG source=', source);
    console.log('DIAG config=', cfg ? JSON.stringify(cfg) : 'config: none');
    console.log('DIAG brevo_key_len=', (env.BREVO_API_KEY ? env.BREVO_API_KEY.length : 0));
    console.log('DIAG service_role_present=', !!env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('DIAG supabase_url=', env.SUPABASE_URL ? 'set' : 'MISSING');

    // 4) Fire the Brevo double opt-in (only reached for new/pending rows). Any
    //    failure keeps the pending row and still returns success — never lose a signup.
    if (cfg && env.BREVO_API_KEY) {
      try {
        const origin = new URL(request.url).origin;
        const redirectionUrl = /^https?:\/\//.test(cfg.redirect_url)
          ? cfg.redirect_url
          : origin + cfg.redirect_url;
        const resp = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            includeListIds: [cfg.brevo_list_id],
            templateId: cfg.doi_template_id,
            redirectionUrl,
            attributes: { SOURCE: source }
          })
        });
        console.log('DIAG brevo_status=', resp.status);
        console.log('DIAG brevo_body=', await resp.text());
      } catch (e) { console.log('DIAG brevo_threw=', String(e)); /* keep pending; succeed anyway */ }
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
