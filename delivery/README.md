# Book delivery

Files live in the private R2 bucket `ultimatum-files` (binding `FILES`, no public
URL). `manifest.json` maps each edition to its files and each file to its R2 key.
Buyers get `/download/<token>` links from `POST /api/deliver`
(`functions/api/deliver.js`), valid 7 days.

## Replace a file

Upload the new file to the **same key** from `manifest.json`. Emails show the new
size automatically; links already sent serve the new file.

Up to 315 MB (EPUB, PDF):

    npx wrangler r2 object put ultimatum-files/ru/ultimatum-ru.epub --remote \
      --file path/to/new.epub --content-type application/epub+zip

Bigger (M4B, MP3, ZIP) — multipart through a local helper with a remote binding:

    (cd delivery/upload && npx wrangler dev --port 8799 --ip 127.0.0.1) &
    python3 delivery/upload/upload.py path/to/new.m4b ru/audio/ultimatum-audiobook.m4b audio/mp4
    # then stop the helper

The chapter ZIP is built with Python `zipfile` (stored, UTF-8 names) from
`AUDIO/RU-главы/*.mp3` into the folder «Ультиматум — аудиокнига по главам/».

## Call it

    curl -X POST https://ultimatumbook.com/api/deliver \
      -H "X-Delivery-Secret: $BOOK_DELIVERY_SECRET" -H 'content-type: application/json' \
      -d '{"order_id":"R-1001","edition":"text_audio","email":"buyer@example.com","code":"ABCD-1234","pro_months":3}'

- `edition`: `text`, `audio`, `text_audio`, `text_audio_pro`.
- Marketing opt-in is not in the body: /api/checkout stores the checkout consents under
  `_delivery/consent/<order_id>`; if «Хочу получать рассылку автора» was ticked, the buyer
  also goes to «Все контакты» with MARKETING_OK / MARKETING_OK_AT.
- Same `order_id` again → 200 `already_sent`, nothing is sent.
- Fresh links for a buyer: `{"order_id":"R-1001","action":"reissue"}` (or `"resend"`; the five
  fields may be sent too) — old links stop working. The app does this for book-order
  `{"action":"resend","email"}`, which the page /ru/links calls via /api/resend.
- Kill the links: `{"order_id":"R-1001","action":"revoke"}`.

Order and token records sit in the same bucket under `_delivery/`.

## Test locally

`wrangler pages dev` uses an empty local bucket. To test against the real files,
add `remote = true` under the top `[[r2_buckets]]` in wrangler.toml for the
session (don't commit it), put `BREVO_API_KEY` and `BOOK_DELIVERY_SECRET` in
`.dev.vars`, and use test order ids — then delete `_delivery/orders/<id>` and the
test contact in Brevo.
