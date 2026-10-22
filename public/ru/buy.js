// /ru/buy — edition, e-mail, optional promo with price preview, consents,
// then /api/checkout creates the order and we POST its form to Robokassa.
(function () {
  var ED = {
    text: { t: 'Электронная книга', d: 'EPUB и PDF, 346 страниц', p: 770, was: 970, m: 2 },
    audio: { t: 'Аудиокнига', d: 'MP3 по главам и M4B, 8 ч 31 мин; PDF с иллюстрациями', p: 870, was: 1270, m: 2 },
    text_audio: { t: 'Электронная книга + аудиокнига', d: 'EPUB, PDF, MP3 и M4B; PDF с иллюстрациями', p: 970, was: 1470, m: 3 },
    text_audio_pro: { t: 'Электронная книга + аудиокнига + год Pro', d: 'Всё из изданий выше и 12 месяцев «Каркас дня» ПРО', p: 2970, was: 3970, m: 12 }
  };
  var $ = function (id) { return document.getElementById(id); };
  var rub = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '₽'; };
  var months = function (n) {
    var a = n % 10, b = n % 100;
    return n + ' ' + (a === 1 && b !== 11 ? 'месяц' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'месяца' : 'месяцев');
  };

  var state = { edition: 'text', promo: '', preview: null, seq: 0 };
  var q = new URLSearchParams(location.search);
  if (ED[q.get('edition')]) state.edition = q.get('edition');

  // edition cards
  var box = $('eds');
  Object.keys(ED).forEach(function (id) {
    var e = ED[id];
    var l = document.createElement('label');
    l.className = 'ed';
    l.innerHTML = '<input type="radio" name="edition" value="' + id + '"' + (id === state.edition ? ' checked' : '') + '>' +
      '<span class="dot" aria-hidden="true"></span><span class="ed-t"></span><span class="ed-p"><s></s><span></span></span><span class="ed-d"></span>';
    l.querySelector('.ed-t').textContent = e.t;
    l.querySelector('.ed-d').textContent = e.d;
    l.querySelector('.ed-p s').textContent = rub(e.was);
    l.querySelector('.ed-p span').textContent = rub(e.p);
    box.appendChild(l);
  });
  box.addEventListener('change', function (ev) {
    state.edition = ev.target.value;
    history.replaceState(null, '', '?edition=' + state.edition);
    state.preview = null;
    render();
    refreshPreview();
  });

  function render() {
    var e = ED[state.edition], p = state.preview;
    var amount = p ? p.amount_rub : e.p;
    var full = p ? p.price_rub : e.p;
    var m = p ? p.pro_months : e.m;
    $('total').innerHTML = '';
    if (full > amount) { var s = document.createElement('s'); s.textContent = rub(full); $('total').appendChild(s); }
    $('total').appendChild(document.createTextNode(rub(amount)));
    $('gift').textContent = state.edition === 'text_audio_pro'
      ? 'Включены ' + months(m) + ' приложения «Каркас дня» ПРО'
      : '+ ' + months(m) + ' приложения «Каркас дня» ПРО в подарок';
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
  var GENERIC = 'Не получилось создать заказ. Попробуй ещё раз через минуту или напиши на md@marketingdark.com.';

  $('buy').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('email').value.trim();
    var ok = true;
    $('form-err').textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

  render();
  refreshPreview();
})();
