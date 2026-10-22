// Book delivery — shared by functions/api/deliver.js and functions/download/[token].js.
//
// Everything lives in the private R2 bucket (binding FILES):
//   ru/...                          the book files, keys from manifest.json
//   _delivery/orders/<order_id>     one JSON per order: edition, email, tokens, status
//   _delivery/tokens/<token>        one JSON per link: order_id, file id, expires_at
// A link is valid while its token object exists and expires_at is in the future;
// revoking an order deletes its token objects.
import manifest from './manifest.json';

export const LINK_TTL_DAYS = 7;
const ORDER_PREFIX = '_delivery/orders/';
const TOKEN_PREFIX = '_delivery/tokens/';

export const editionId = (raw) =>
  String(raw || '').trim().toLowerCase().replace(/[+\s-]+/g, '_');
export const getEdition = (id) => manifest.editions[id] || null;
export const getFile = (id) => manifest.files[id] || null;

// ── store ────────────────────────────────────────────────────────────────────
const readJson = async (env, key) => {
  const o = await env.FILES.get(key);
  return o ? o.json() : null;
};
const writeJson = (env, key, value) =>
  env.FILES.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });

export const getOrder = (env, orderId) => readJson(env, ORDER_PREFIX + orderId);
export const putOrder = (env, order) => writeJson(env, ORDER_PREFIX + order.order_id, order);
export const deleteOrder = (env, orderId) => env.FILES.delete(ORDER_PREFIX + orderId);
export const getToken = (env, token) => readJson(env, TOKEN_PREFIX + token);

// Checkout consents, keyed by the app's order_id (written by /api/checkout).
const CONSENT_PREFIX = '_delivery/consent/';
export const getConsent = (env, orderId) => readJson(env, CONSENT_PREFIX + orderId);
export const putConsent = (env, orderId, consent) => writeJson(env, CONSENT_PREFIX + orderId, consent);

const newToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// One token per file of the edition. Returns [{ token, file }] in manifest order.
export async function issueTokens(env, orderId, edition, expiresAt) {
  const out = [];
  for (const file of edition.files) {
    const token = newToken();
    await writeJson(env, TOKEN_PREFIX + token, { order_id: orderId, file, expires_at: expiresAt });
    out.push({ token, file });
  }
  return out;
}

export const revokeTokens = (env, tokens = []) =>
  tokens.length ? env.FILES.delete(tokens.map((t) => TOKEN_PREFIX + t.token)) : null;

// ── email ────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const formatSize = (bytes) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${Math.round(mb)} МБ`;
  return `${mb.toFixed(1).replace('.', ',')} МБ`;
};

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const monthsLabel = (n) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`;

export const formatDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', {
  day: 'numeric', month: 'long', timeZone: 'Europe/Moscow'
});

// links: [{ url, title, hint, size }]. invId — the short order number the buyer
// sees (also on the receipt); the uuid order id stays internal.
export function buildEmail({ edition, links, code, proMonths, expiresAt, invId, reissue }) {
  const until = formatDate(expiresAt);
  const months = monthsLabel(proMonths);
  // pro_3m / pro_12m: no files — only the code, the months and the steps.
  const proOnly = links.length === 0;
  const subject = proOnly
    ? (reissue ? '«Каркас дня» Про — твой код ещё раз' : `«Каркас дня» Про — твой код на ${months}`)
    : reissue
      ? 'Ультиматум — новые ссылки на твои файлы'
      : 'Ультиматум — твои файлы и код «Каркас дня» Про';
  const intro = proOnly
    ? (reissue ? 'Держи код «Каркас дня» Про ещё раз.' : 'Спасибо за покупку «Каркас дня» Про. Ниже — код и как его активировать.')
    : reissue
      ? 'Держи свежие ссылки на файлы «Ультиматума». Старые больше не работают.'
      : 'Спасибо за покупку «Ультиматума» напрямую у меня. Ниже — ссылки на файлы и код приложения.';
  const bookLine = 'P.S. У меня вышла книга «Ультиматум. Уйти на фриланс и не вернуться» — о том, как уйти на фриланс и выстроить свою систему. Подробнее: ultimatumbook.com/ru';
  const helpText = 'Если код не активируется или что-то непонятно — просто ответь на это письмо.';
  // One wording for every edition, in both the HTML and the text version.
  const validity = `Ссылки работают 7 дней — до ${until} включительно. Скачай файлы и сохрани у себя.`;
  const steps = [
    'Открой daily-frame.app и войди или зарегистрируйся.',
    'Зайди в Настройки → Профиль, карточка «Доступ».',
    'Вставь код в поле и нажми «Активировать». Если идёт пробный период — сначала «Ввести код», если Про уже активен — сначала кнопку продления.'
  ];
  const proNote = `«Каркас дня» Про включится на ${months} с момента активации. Код одноразовый — активируй его в своём аккаунте.`;
  const expiredH = 'Если ссылки истекли или что-то не скачивается';
  const expiredText = 'Новые ссылки можно запросить на странице ultimatumbook.com/ru/links — они придут на этот адрес. Или просто ответь на это письмо.';
  const orderLine = invId ? `Номер заказа: ${invId}.` : '';

  const P = 'margin:0 0 16px;font-size:16px;line-height:1.55;color:#1a1a1a';
  const H = 'margin:28px 0 12px;font-size:18px;line-height:1.3;color:#1a1a1a';
  const A = 'color:#c4161c';
  const linkRows = links.map((l) => `
    <tr><td style="padding:12px 0;border-top:1px solid #e6e2dc">
      <a href="${esc(l.url)}" style="font-size:16px;font-weight:600;color:#c4161c;text-decoration:underline">${esc(l.title)}</a>
      <div style="font-size:14px;line-height:1.45;color:#6b6560;margin-top:4px">${esc(formatSize(l.size))} · ${esc(l.hint)}</div>
    </td></tr>`).join('');
  const linkify = (s) => esc(s)
    .replace('daily-frame.app', `<a href="https://daily-frame.app" style="${A}">daily-frame.app</a>`)
    .replace('ultimatumbook.com/ru/links', `<a href="https://ultimatumbook.com/ru/links" style="${A}">ultimatumbook.com/ru/links</a>`)
    .replace(/ultimatumbook\.com\/ru$/, `<a href="https://ultimatumbook.com/ru/" style="${A}">ultimatumbook.com/ru</a>`);

  const proHtml = code ? `
    <h2 style="${H}">Код «Каркас дня» Про — ${esc(months)}</h2>
    <p style="${P}"><span style="display:inline-block;padding:10px 16px;border:2px dashed #1a1a1a;font:700 20px/1.2 'Courier New',monospace;letter-spacing:1px">${esc(code)}</span></p>
    <ol style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.55;color:#1a1a1a">
      ${steps.map((s) => `<li>${linkify(s)}</li>`).join('\n      ')}
    </ol>
    <p style="${P}">${esc(proNote)}</p>` : '';

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;font-family:Arial,Helvetica,sans-serif"><tr><td style="padding:32px 28px">
      <p style="margin:0 0 24px;font-size:13px;letter-spacing:2px;color:#6b6560">УЛЬТИМАТУМ</p>
      <p style="${P}">Привет!</p>
      <p style="${P}">${esc(intro)}</p>
      ${proOnly ? '' : `<h2 style="${H}">Файлы — ${esc(edition.title)}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linkRows}</table>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#6b6560">${esc(validity)}</p>`}
      ${proHtml}
      ${proOnly
        ? `<p style="${P}">${esc(helpText)}${orderLine ? ' ' + esc(orderLine) : ''}</p>
      <p style="${P}">Хороших дней с «Каркасом»!<br>Константин</p>
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e6e2dc;font-size:14px;line-height:1.5;color:#6b6560">${linkify(bookLine)}</p>`
        : `<h2 style="${H}">${esc(expiredH)}</h2>
      <p style="${P}">${linkify(expiredText)}${orderLine ? ' ' + esc(orderLine) : ''}</p>
      <p style="${P}">Приятного чтения!<br>Константин</p>`}
    </td></tr></table>
  </td></tr></table>
</body></html>`;

  const text = [
    'Привет!', '', intro, '',
    ...(proOnly ? [] : [
      `Файлы — ${edition.title}:`, '',
      ...links.map((l) => `${l.title} (${formatSize(l.size)}):\n${l.url}\n`),
      validity, ''
    ]),
    ...(code ? [
      `Код «Каркас дня» Про — ${months}: ${code}`,
      ...steps.map((s, i) => `${i + 1}. ${s}`),
      proNote, ''
    ] : []),
    ...(proOnly
      ? [helpText, ...(orderLine ? [orderLine] : []), '', 'Хороших дней с «Каркасом»!', 'Константин', '', bookLine]
      : [`${expiredH}:`, expiredText, ...(orderLine ? [orderLine] : []), '', 'Приятного чтения!', 'Константин'])
  ].join('\n');

  return { subject, html, text };
}

// ── Brevo ────────────────────────────────────────────────────────────────────
const brevo = (env, path, body) => fetch(`https://api.brevo.com/v3${path}`, {
  method: 'POST',
  headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body)
});

// Resolves to { ok, messageId?, status, error? }. ok only on Brevo's 201.
export async function sendEmail(env, { to, subject, html, text, orderId }) {
  const resp = await brevo(env, '/smtp/email', {
    sender: { name: 'Константин | Marketing.Dark', email: env.DELIVERY_SENDER_EMAIL },
    replyTo: { name: 'Константин | Marketing.Dark', email: 'md@marketingdark.com' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
    tags: ['book-delivery'],
    headers: { 'X-Mailin-custom': `order:${orderId}` }
  });
  const body = await resp.json().catch(() => ({}));
  return resp.status === 201
    ? { ok: true, status: 201, messageId: body.messageId }
    : { ok: false, status: resp.status, error: body.code || body.message || 'brevo error' };
}

// Buyers go to the transactional list «Покупатели книги» (no newsletters);
// to the marketing list «Все контакты» only when they opted in at checkout
// (marketingAt = when). Without consent MARKETING_OK is left untouched, so an
// earlier opt-in is never overwritten.
export async function upsertBuyer(env, { email, edition, proUntil, marketingAt }) {
  const listIds = [Number(env.BREVO_BUYERS_LIST_ID)];
  const attributes = { BUYER: edition, ...(proUntil ? { PRO_UNTIL: proUntil } : {}) };
  if (marketingAt && env.BREVO_MARKETING_LIST_ID) {
    listIds.push(Number(env.BREVO_MARKETING_LIST_ID));
    attributes.MARKETING_OK = true;
    attributes.MARKETING_OK_AT = marketingAt.slice(0, 10);
  }
  const resp = await brevo(env, '/contacts', {
    email,
    updateEnabled: true,
    listIds,
    attributes
  });
  return resp.ok;
}

export const addMonths = (date, months) => {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
