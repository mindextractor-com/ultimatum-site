// Seller's e-mail and phone are not in the HTML as text (scrapers and spam
// bots read the markup). Placeholders <a data-c="mail" data-s="subject">
// and <a data-c="tel"> get the address, the number and working mailto:/tel:
// links here, on page load.
(function () {
  var mail = ['md', 'marketingdark.com'].join('@');
  var tel = ['+7', '915', '416', '95', '16'];
  var telHref = 'tel:' + tel.join('');
  var telText = tel[0] + ' ' + tel[1] + ' ' + tel[2] + '-' + tel[3] + '-' + tel[4];
  function fill() {
    document.querySelectorAll('a[data-c="mail"]').forEach(function (a) {
      var s = a.getAttribute('data-s');
      a.href = 'mailto:' + mail + (s ? '?subject=' + encodeURIComponent(s) : '');
      a.textContent = mail;
    });
    document.querySelectorAll('a[data-c="tel"]').forEach(function (a) {
      a.href = telHref;
      a.textContent = telText;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();
})();
