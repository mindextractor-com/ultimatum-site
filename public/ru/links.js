// /ru/links — the answer is the same whether or not an order exists.
(function () {
  var form = document.getElementById('links'), email = document.getElementById('email');
  var err = document.getElementById('email-err'), btn = document.getElementById('send');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      err.textContent = 'Проверь e-mail — похоже, в нём ошибка.';
      email.setAttribute('aria-invalid', 'true');
      email.focus();
      return;
    }
    err.textContent = '';
    email.removeAttribute('aria-invalid');
    btn.disabled = true;
    btn.textContent = 'Отправляем…';
    var done = function () {
      form.hidden = true;
      var d = document.getElementById('done');
      d.hidden = false;
      d.setAttribute('tabindex', '-1');
      d.focus();
    };
    fetch('/api/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: v }) })
      .then(done, done);
  });
})();
