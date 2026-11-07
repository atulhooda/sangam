import "server-only";

/*
 * The app's public origin, for links it hands out (pay links, callbacks)
 * and for vetting links it is asked to fetch. Behind Railway's proxy
 * `req.url` is the bind address (https://0.0.0.0:8080), which no browser can
 * open and which the agent's URL vetting rightly refuses as loopback; the
 * proxy puts the real host in x-forwarded-host / x-forwarded-proto.
 */
export function publicOrigin(req: Request): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();
  if (!host) return new URL(req.url).origin;
  const proto = (req.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.|0\.0\.0\.0)/.test(host) ? "http" : "https")).split(",")[0]!.trim();
  return `${proto}://${host}`;
}
