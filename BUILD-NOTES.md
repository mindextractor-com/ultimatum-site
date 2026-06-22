# BUILD-NOTES — Ультиматум Landing Page

## Локальный сервер
```
http://127.0.0.1:8080/
```
Запуск: `python3 -m http.server 8080 --bind 127.0.0.1` из корня проекта.

---

## Что сделано

### Шрифты
Источник: `../Yandex.Disk.localized/OMNISPRO/Websites/_fonts-pool/`  
Выбраны три семейства по брифу, сабсет cyr+lat+пунктуация через `pyftsubset`:

| Слот | Семейство | Файлы в `fonts/` |
|------|-----------|-----------------|
| `--font-display` | Albertus Nova | regular / bold / black |
| `--font-text` | Jost | variable (wght 100–900) + italic variable |
| `--font-mono` | Ubuntu Mono | regular / italic / bold / bold-italic |

Все — woff2, `font-display: swap`, локально, без CDN.  
Albertus Nova: настоящих италиков нет в пуле, использован Regular/Bold/Black (для дисплейного применения достаточно).

### Архитектура «Двух Миров»
**Техника**: каждая секция — `position: relative; overflow: hidden; background: var(--d-bg)` (тёмный мир).  
Поверх — абсолютный div `.s-light` с `background: var(--l-bg)` и `clip-path: polygon(...)` — рваный контур.  
Красная аура вдоль разрыва: `filter: drop-shadow(-5px 0 14px rgba(255,42,56,.45))` на `.s-light` — shadow следует за формой clip-path автоматически.

**Пропорции тьма/свет по секциям:**
| Секция | Тьма | Свет | Логика |
|--------|------|------|--------|
| Hero | 55% | 45% | Начинаем в пещере |
| 01 Посыл | 65% | 35% | Глубокая тьма, жёсткий посыл |
| 02 Маршруты | 48% | 52% | Переход, появляется путь |
| 03 Структура | 37% | 63% | Система = свет |
| 04 Опоры | 32% | 68% | Свободы больше |
| 05 Daily Frame | 42% | 58% | Инструмент = мост |
| 06 Голос | 35% | 65% | Мудрость на свету |
| 07 Автор | 50% | 50% | Баланс — автор прошёл оба мира |
| 08 Waitlist | 62% | 38% | Тьма тянет к решению |

**Мобильный** (≤768px): split горизонтальный — тёмный мир вверху, светлый внизу. Clip-path разворачивается в горизонтальный рваный рубец, shadow меняется на `drop-shadow(0 -5px 14px ...)`.

### Типографика как композиция (Hero H1)
Не один шрифт в одну строку — три уровня:
- `.disp` → Albertus Nova 900, очень крупно — ключевые слова *Уйти*, *фриланс*, *вернуться*
- `.conn` → Jost 300, ~45% от `.disp` — связки «на», «и», « »
- `.red` → Jost 700 italic, красный — слово «не»

### Фоновые изображения
Слоты `.s-bg-dark` (dark world, left) и `.s-light-img` (light world, right):
- `images/u-world-dark.webp` — пещера/ночь, портретный формат
- `images/u-world-light.webp` — рассвет/природа, портретный формат
- `images/u-og.jpg` — 1200×630 OG-карточка
- `images/cover-ru.png` — мокап обложки (1024×1535)
- `images/photo.jpg` — фото автора (≈900×1125)
- `images/app-1.png`, `app-2.png`, `app-3.png` — скриншоты Daily Frame

Все `onerror="this.style.display='none'"` — без картинок сайт держится на CSS.

### Daily Frame (секция 05)
Добавлена между «Три опоры» и «Голос» по ТЗ.  
Весь копирайт — дословно из ТЗ.  
Базовая версия: список 4 пунктов.  
Полная версия: аккордеон (закрыт по умолчанию, aria-expanded).  
CTA: ссылка на `#waitlist` + внешняя `https://daily-frame.app`.  
Скриншоты: слоты `images/app-1.png` … `app-3.png`, пустые заглушки.

### Подписка
`functions/api/subscribe.js` — Cloudflare Pages Function, уже готов.  
POST `/api/subscribe` → `{ email, source: 'book-ru' }` → Supabase `book_waitlist`.  
**Env нужно задать самому**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` в Cloudflare Pages → Settings → Environment Variables.

### Что оставлено на тебя
1. **Env vars** в Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
2. **Деплой**: Cloudflare Pages, branch `main`, preset None, build empty, output empty, SSL Full
3. **Картинки**:
   - `images/u-world-dark.webp` — пещера/ночь (portrait ≈ 1000×1600)
   - `images/u-world-light.webp` — рассвет/природа (portrait ≈ 1000×1600)
   - `images/cover-ru.png` — мокап обложки (1024×1535)
   - `images/photo.jpg` — фото автора (≈900×1125, 4:5)
   - `images/app-1.png`, `app-2.png`, `app-3.png` — скриншоты Daily Frame (9:19)
   - `images/u-og.jpg` — OG (1200×630)
4. **Аналитика**: слот в `<head>` помечен `<!-- ANALYTICS -->`, вставь скрипт
5. **EN-версия**: позже на `/en/` — все тексты в HTML, не в изображениях; шрифты содержат латиницу; структура копируется

### Допущения и решения
- **Нет cyber-noir**: никакого neon, scanlines, Tokyo — чисто chiaroscuro, пещера↔рассвет
- **Текст читаем на обоих фонах**: большие заголовки с `text-shadow: 0 2px 20px rgba(14,15,21,.4)`, dark cards на route/structure через `backdrop-filter` — белый текст читаем везде
- **Светлый мир**: `#ECEFF2` — холодный, без желтизны и бежа
- **Красный**: только `#FF2A38` — на «не» в H1, на стрелках опор, на номерах карточек, на кнопке, на полосе обложки, на разрыве (через drop-shadow)
- **Scroll reveal**: IntersectionObserver с graceful degradation (нет observer → всё видно сразу)
- **prefers-reduced-motion**: гасит marquee (показывает статически), scroll-анимации, hint-bobble
- **Mobile**: min-width:320px, overflow-x:hidden, H1 через clamp + overflow-wrap:break-word + min-width:0, горизонтальный scroll невозможен

---

## Структура файлов
```
ultimatum-site/
├── index.html              ← единственный файл сайта (РУ, main)
├── hero-alt-1.html         ← альтернатива: центровка + слово-фон
├── hero-alt-2.html         ← альтернатива: стена-заголовок + сайдбар
├── fonts/
│   ├── albertus-nova-regular.woff2
│   ├── albertus-nova-bold.woff2
│   ├── albertus-nova-black.woff2
│   ├── jost-variable.woff2
│   ├── jost-italic-variable.woff2
│   ├── ubuntu-mono-regular.woff2
│   ├── ubuntu-mono-italic.woff2
│   ├── ubuntu-mono-bold.woff2
│   └── ubuntu-mono-bold-italic.woff2
├── functions/
│   └── api/
│       └── subscribe.js    ← Cloudflare Pages Function, готов
├── images/
│   └── .keep
├── lab-fonts/              ← 154 woff2 из аудита шрифтов (Фаза 0)
├── font-lab.html           ← примерочная (живая, Фаза 0)
└── BUILD-NOTES.md          ← этот файл
```
