// Browsers and crawlers ask for /favicon.ico regardless of the <link>; the site's icon is the SVG.
export function GET(req: Request) {
  return Response.redirect(new URL("/icon.svg", req.url), 308);
}
