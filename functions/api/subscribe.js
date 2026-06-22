// Cloudflare Pages Function — POST /api/subscribe
// Env (Pages → Settings → Environment variables): SUPABASE_URL, SUPABASE_ANON_KEY
// Supabase SQL (один раз, если таблицы ещё нет):
//   create table if not exists book_waitlist(
//     id uuid primary key default gen_random_uuid(),
//     email text not null,
//     source text not null default 'md',
//     created_at timestamptz default now(),
//     unique(email, source)
//   );
//   alter table book_waitlist enable row level security;
//   create policy "anon insert" on book_waitlist for insert to anon with check (true);
export async function onRequestPost({ request, env }) {
  try {
    const { email, source } = await request.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'invalid email' }, 400);
    }
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/book_waitlist`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ email, source: source || 'md' })
    });
    if (r.ok || r.status === 409) return json({ ok: true }, 200);
    return json({ error: 'db' }, 500);
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
}
const json = (o, s) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
