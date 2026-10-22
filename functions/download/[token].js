// Cloudflare Pages Function — GET/HEAD /download/<token>
// Streams the book file from the private R2 bucket if the token is valid
// (issued by /api/deliver, not expired, not revoked). Range requests work, so
// big audio files can resume. Otherwise: a short Russian page on how to get
// fresh links.
import { getToken, getFile } from '../../delivery/lib.js';

export const onRequestGet = (ctx) => serve(ctx, false);
export const onRequestHead = (ctx) => serve(ctx, true);

async function serve({ request, env, params }, headOnly) {
  const token = String(params.token || '');
  const rec = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await getToken(env, token) : null;
  if (!rec || Date.parse(rec.expires_at) <= Date.now()) return expired();

  const file = getFile(rec.file);
  // R2 can briefly refuse parallel reads of one object (error 10058) — retry.
  let obj;
  for (let attempt = 0; ; attempt++) {
    try {
      obj = headOnly
        ? await env.FILES.head(file.key)
        : await env.FILES.get(file.key, { range: request.headers, onlyIf: request.headers });
      break;
    } catch (e) {
      if (attempt === 2) {
        return new Response('Busy, try again in a few seconds', { status: 503, headers: { 'retry-after': '5' } });
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!obj) return expired();

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex');
  headers.set('content-disposition', disposition(file.download_name, file.key));

  if (headOnly) {
    headers.set('content-length', String(obj.size));
    return new Response(null, { status: 200, headers });
  }
  if (!('body' in obj)) return new Response(null, { status: 304, headers }); // If-None-Match hit
  if (obj.range && request.headers.has('range')) {
    const offset = obj.range.offset ?? obj.size - obj.range.suffix;
    const length = obj.range.length ?? obj.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// ASCII fallback from the key, the Russian name for browsers that read filename*.
const disposition = (name, key) =>
  `attachment; filename="${key.split('/').pop()}"; filename*=UTF-8''${encodeURIComponent(name)}`;

const expired = () => new Response(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Ссылка больше не работает — Ультиматум</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f1ec; --fg: #1a1a1a; --muted: #6b6560; --accent: #c4161c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121110; --fg: #f1ede6; --muted: #a39d95; --accent: #ff4a52; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.55 Jost, Arial, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 64px 16px; }
  .k { font-size: 13px; letter-spacing: 2px; color: var(--muted); margin: 0 0 24px; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 16px; }
  a { color: var(--accent); }
</style></head>
<body><main>
  <p class="k">УЛЬТИМАТУМ</p>
  <h1>Ссылка больше не работает</h1>
  <p>Ссылки на файлы книги действуют 7 дней с момента отправки письма. Эта истекла или была заменена новой.</p>
  <p>Чтобы получить свежие ссылки, ответь на письмо с файлами или напиши на <a href="mailto:md@marketingdark.com">md@marketingdark.com</a> с адреса, указанного при оплате, — пришлю новые.</p>
  <p><a href="/ru">На главную</a></p>
</main></body></html>`, {
  status: 410,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
});
