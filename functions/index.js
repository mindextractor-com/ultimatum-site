// TEMPORARY: the exact root / goes to the Russian version (302), query string
// kept. Only this path — /offer, /delivery and other English pages are served
// as usual. Delete this file to bring the English home page back.
export const onRequest = ({ request }) => {
  const url = new URL(request.url);
  url.pathname = '/ru';
  return Response.redirect(url.toString(), 302);
};
