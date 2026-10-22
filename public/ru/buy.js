// /ru/buy — edition, e-mail, optional promo with price preview, consents,
// then /api/checkout creates the order and we POST its form to Robokassa.
(function () {
  var ED = {
    text: { t: 'Электронная книга', d: 'EPUB и PDF, 346 страниц', p: 770, was: 970 },
    audio: { t: 'Аудиокнига', d: 'MP3 по главам и M4B, 8 ч 31 мин; PDF с иллюстрациями', p: 870, was: 1270 },
    text_audio: { t: 'Электронная книга + аудиокнига', d: 'EPUB, PDF, MP3 и M4B; PDF с иллюстрациями', p: 970, was: 1470 },
    text_audio_pro: { t: 'Электронная книга + аудиокнига + год Про', d: 'Всё из изданий выше', p: 2970, was: 3970 },
    // «Каркас дня» Про on its own: shown only once the app sells it (/api/editions
    // lists it); title months and prices come from there.
    pro_3m: { pro: true, d: 'Доступ к приложению «Каркас дня» Про — код придёт на e-mail' },
    pro_12m: { pro: true, d: 'Доступ к приложению «Каркас дня» Про — код придёт на e-mail' }
  };
  // «Каркас дня» Про months come from the app (/api/editions, then the price
  // preview of the chosen edition) — never hardcoded here.
  var PRO = '«Каркас\u00a0дня» Про';
  var $ = function (id) { return document.getElementById(id); };
  var rub = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '₽'; };
  var months = function (n) {
    var a = n % 10, b = n % 100;
    return n + ' ' + (a === 1 && b !== 11 ? 'месяц' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'месяца' : 'месяцев');
  };

  var state = { edition: 'text', promo: '', preview: null, seq: 0, info: {} };
  var bonus = function (id, m) { return (id === 'text_audio_pro' ? '' : '+ ') + months(m) + ' ' + PRO; };
  var q = new URLSearchParams(location.search);
  var wanted = ED[q.get('edition')] ? q.get('edition') : null;
  if (wanted && !ED[wanted].pro) state.edition = wanted;

  // ?email= (e.g. from the app's «Купить Про»): prefill if it is a valid
  // address, otherwise ignore it. Then drop it from the URL at once, so it
  // stays out of the history and of the Referer sent to Robokassa. Never logged.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (q.has('email')) {
    var pre = (q.get('email') || '').trim();
    if (EMAIL_RE.test(pre) && pre.length <= 254) $('email').value = pre;
    q.delete('email');
    var rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }

  // edition cards: books in #eds, «Только «Каркас дня» Про» in #eds-pro
  var box = $('eds');
  Object.keys(ED).forEach(function (id) {
    var e = ED[id];
    var l = document.createElement('label');
    l.className = 'ed';
    l.innerHTML = '<input type="radio" name="edition" value="' + id + '"' + (id === state.edition ? ' checked' : '') + '>' +
      '<span class="dot" aria-hidden="true"></span><span class="ed-t"></span><span class="ed-p"><s></s><span></span></span>' +
      '<span class="ed-d"><span class="ed-what"></span><span class="ed-b" data-bonus="' + id + '"></span></span>';
    l.querySelector('.ed-t').textContent = e.t || '';
    l.querySelector('.ed-what').textContent = e.d;
    if (e.was) l.querySelector('.ed-p s').textContent = rub(e.was);
    if (e.p) l.querySelector('.ed-p span').textContent = rub(e.p);
    (e.pro ? $('eds-pro') : box).appendChild(l);
  });
  $('buy').addEventListener('change', function (ev) {
    if (ev.target.name !== 'edition') return;
    state.edition = ev.target.value;
    history.replaceState(null, '', '?edition=' + state.edition);
    state.preview = null;
    render();
    refreshPreview();
  });

  function render() {
    var e = ED[state.edition], p = state.preview;
    var info = state.info[state.edition];
    var amount = p ? p.amount_rub : info ? info.amount_rub : e.p;
    var full = p ? p.price_rub : info ? info.price_rub : e.p;
    var m = p ? p.pro_months : info && info.pro_months;
    $('total').innerHTML = '';
    if (full > amount) { var s = document.createElement('s'); s.textContent = rub(full); $('total').appendChild(s); }
    $('total').appendChild(document.createTextNode(rub(amount)));
    $('gift').textContent = !m ? '' : e.pro
      ? 'Доступ к приложению ' + PRO + ' на ' + months(m) + ' — код придёт на e-mail'
      : state.edition === 'text_audio_pro'
      ? 'Включены ' + months(m) + ' приложения ' + PRO
      : '+ ' + months(m) + ' приложения ' + PRO + ' в подарок';
    $('pay').textContent = 'Перейти к оплате · ' + rub(amount);
  }

  // price preview (with the promo, if one is applied)
  function refreshPreview(fromApply) {
    var my = ++state.seq;
    var url = '/api/checkout?edition=' + state.edition + (state.promo ? '&promo=' + encodeURIComponent(state.promo) : '');
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (my !== state.seq) return;
      if (d.ok) {
        state.preview = d;
        $('promo-err').textContent = '';
        $('promo-msg').textContent = state.promo && d.discount_rub > 0
          ? 'Промокод ' + (d.promo_code || state.promo) + ' применён: скидка ' + rub(d.discount_rub) + '.'
          : state.promo ? 'Промокод ' + (d.promo_code || state.promo) + ' применён.' : '';
      } else if (d.error === 'promo_invalid') {
        state.promo = '';
        state.preview = null;
        $('promo-msg').textContent = '';
        $('promo-err').textContent = 'Такого промокода нет или он больше не действует.';
        if (!fromApply) refreshPreview();
      }
      render();
    }).catch(function () { /* keep the list prices */ });
  }

  $('promo-open').addEventListener('click', function () {
    $('promo-box').hidden = false;
    this.setAttribute('aria-expanded', 'true');
    this.hidden = true;
    $('promo').focus();
  });
  function applyPromo() {
    var v = $('promo').value.trim();
    $('promo-err').textContent = '';
    if (!v) { state.promo = ''; $('promo-msg').textContent = ''; refreshPreview(); return; }
    state.promo = v;
    $('promo-msg').textContent = 'Проверяем…';
    refreshPreview(true);
  }
  $('promo-apply').addEventListener('click', applyPromo);
  $('promo').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); applyPromo(); } });

  var ERR = {
    invalid_email: 'Проверь e-mail — похоже, в нём ошибка.',
    promo_invalid: 'Такого промокода нет или он больше не действует.',
    rate_limited: 'Слишком много попыток подряд. Подожди минуту и попробуй снова.',
    unknown_edition: 'Выбери издание.'
  };
  var GENERIC = 'Не получилось создать заказ. Попробуй ещё раз через минуту или напиши в Telegram @marketing_dark.';

  $('buy').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('email').value.trim();
    var ok = true;
    $('form-err').textContent = '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      $('email-err').textContent = email ? ERR.invalid_email : 'Укажи e-mail — на него придут файлы.';
      $('email').setAttribute('aria-invalid', 'true');
      ok = false;
    } else { $('email-err').textContent = ''; $('email').removeAttribute('aria-invalid'); }
    if (!$('c-offer').checked || !$('c-pd').checked) {
      $('consent-err').textContent = 'Чтобы оформить заказ, отметь согласие с офертой и на обработку персональных данных.';
      ok = false;
    } else $('consent-err').textContent = '';
    if (!ok) { (email && /@/.test(email) ? $('c-offer') : $('email')).focus(); return; }

    var btn = $('pay');
    btn.disabled = true;
    btn.textContent = 'Создаём заказ…';
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        edition: state.edition, email: email, promo: state.promo || undefined,
        accept_offer: true, accept_pd: true, marketing: $('c-mkt').checked
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw d;
      try { sessionStorage.setItem('ult_edition', state.edition); } catch (_) {}
      btn.textContent = 'Переходим к оплате…';
      var f = d.payment_form;
      if (f && f.action && f.fields) {
        var form = document.createElement('form');
        form.method = f.method || 'POST';
        form.action = f.action;
        form.acceptCharset = 'UTF-8';
        Object.keys(f.fields).forEach(function (k) {
          var i = document.createElement('input');
          i.type = 'hidden'; i.name = k; i.value = f.fields[k];
          form.appendChild(i);
        });
        document.body.appendChild(form);
        form.submit();
      } else if (d.payment_url) {
        location.href = d.payment_url;
      } else throw {};
    }).catch(function (d) {
      btn.disabled = false;
      render();
      var e = d && d.error;
      if (e === 'promo_invalid') { $('promo-err').textContent = ERR.promo_invalid; state.promo = ''; refreshPreview(); return; }
      if (e === 'invalid_email') { $('email-err').textContent = ERR.invalid_email; $('email').focus(); return; }
      $('form-err').textContent = ERR[e] || GENERIC;
    });
  });

  // back from Robokassa via the browser's back button: re-enable the form
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) { $('pay').disabled = false; render(); } });

  // bonus months (and current prices) of every edition for the cards
  fetch('/api/editions').then(function (r) { return r.json(); }).then(function (d) {
    state.info = d.editions || {};
    Object.keys(state.info).forEach(function (id) {
      var x = state.info[id], card = document.querySelector('[data-bonus="' + id + '"]');
      if (!card || !x.pro_months || !ED[id]) return;
      var ed = card.closest('.ed');
      if (x.amount_rub) ed.querySelector('.ed-p span').textContent = rub(x.amount_rub);
      if (ED[id].pro) {
        ed.querySelector('.ed-t').textContent = PRO + ' — ' + months(x.pro_months);
        if (x.price_rub > x.amount_rub) ed.querySelector('.ed-p s').textContent = rub(x.price_rub);
        $('pro-group').hidden = false;
      } else card.textContent = bonus(id, x.pro_months);
    });
    if (wanted && ED[wanted].pro && state.info[wanted]) {
      state.edition = wanted;
      document.querySelector('input[name="edition"][value="' + wanted + '"]').checked = true;
      state.preview = null;
      refreshPreview();
      $('pro-group').scrollIntoView({ block: 'start' }); // came from «Купить Про»
    }
    render();
  }).catch(function () { /* cards stay without the bonus line */ });

  render();
  refreshPreview();
})();
