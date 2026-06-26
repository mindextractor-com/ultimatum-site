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

    // 1) Upsert the signup as pending (keeps existing source logic).
    const up = await sb('book_waitlist?on_conflict=email,source', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email, source, status: 'pending' })
    });
    if (!up.ok && up.status !== 409) return json({ error: 'db' }, 500);

    // 2) Look up the Brevo config for this source.
    let cfg = null;
    try {
      const c = await sb(
        `waitlists?source=eq.${encodeURIComponent(source)}` +
        `&select=brevo_list_id,doi_template_id,redirect_url,lang&limit=1`
      );
      if (c.ok) cfg = (await c.json())[0] || null;
    } catch (_) { /* no config → skip Brevo, still succeed */ }

    // 3) Fire the Brevo double opt-in. Any failure keeps the pending row and
    //    still returns success — we never lose a signup.
    if (cfg && env.BREVO_API_KEY) {
      try {
        const origin = new URL(request.url).origin;
        const redirectionUrl = /^https?:\/\//.test(cfg.redirect_url)
          ? cfg.redirect_url
          : origin + cfg.redirect_url;
        await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
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
