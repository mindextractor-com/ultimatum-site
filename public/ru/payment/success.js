// /ru/payment/success — Robokassa returns the buyer with InvId and Shp_order.
// Only Shp_order (our order id) is used; the page shows the status and a
// masked e-mail, never the code or links. Pending is re-checked for a while.
(function () {
  var box = document.getElementById('status'), h = document.getElementById('h');
  var id = new URLSearchParams(location.search).get('Shp_order') || '';
  var tries = 0, MAX = 12, EVERY = 5000;

  function show(title, html, ok) {
    h.textContent = title;
    box.className = 'status' + (ok ? ' ok' : '');
    box.innerHTML = html;
  }
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  function check() {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      show('Спасибо за заказ', '<p>Не получилось определить номер заказа. Если оплата прошла, письмо с файлами придёт на e-mail, указанный при оплате, в течение 15 минут.</p>');
      return;
    }
    tries++;
    fetch('/api/order-status?order=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok && d.status === 'paid') {
          show('Оплата прошла', '<p><strong>Спасибо!</strong> Письмо с файлами и кодом «Каркас дня» ПРО уже в пути на <strong>' + esc(d.email) + '</strong>.</p><p>Обычно оно приходит за пару минут, иногда — до 15.</p>', true);
        } else if (d.ok && d.status === 'pending') {
          if (tries < MAX) {
            show('Ждём подтверждения банка', '<p><span class="spinner" aria-hidden="true"></span>Банк ещё подтверждает оплату. Как только подтвердит, письмо с файлами придёт на <strong>' + esc(d.email) + '</strong>.</p>');
            setTimeout(check, EVERY);
          } else {
            show('Ждём подтверждения банка', '<p>Банк пока не подтвердил оплату — иногда это занимает несколько минут. Как только подтвердит, письмо с файлами придёт на <strong>' + esc(d.email) + '</strong>. Эту страницу можно закрыть.</p>');
          }
        } else if (d.ok && d.status === 'refunded') {
          show('Заказ отменён', '<p>По этому заказу оформлен возврат. Если это ошибка — напиши нам.</p>');
        } else if (d.error === 'not_found') {
          show('Заказ не найден', '<p>Не нашли такой заказ. Если оплата прошла, письмо с файлами придёт на e-mail, указанный при оплате, в течение 15 минут.</p>');
        } else throw d;
      })
      .catch(function () {
        if (tries < 3) { setTimeout(check, EVERY); return; }
        show('Спасибо за заказ', '<p>Не получилось проверить статус. Если оплата прошла, письмо с файлами придёт на e-mail, указанный при оплате, в течение 15 минут.</p>');
      });
  }
  check();
})();
