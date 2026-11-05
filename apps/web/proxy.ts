import { NextResponse, type NextRequest } from "next/server";

/*
 * Lets one build of this app also run as the two demo shops' own websites.
 *
 *   SHOP_SITE=rail      this deployment is RailKart (the honest railway shop)
 *   SHOP_SITE=bakery    this deployment is Crumbs & Co. (the hacked bakery)
 *   (unset)             this deployment is Sangam itself
 *
 * Or, for one deployment with several custom domains, pick by host:
 *   RAILKART_HOSTS=railkart.example.com   BAKERY_HOSTS=crumbs.example.com
 *
 * A shop site serves its storefront at "/" and only the routes the storefront
 * needs (its APIs, sign-in, the bakery's invoice backend). Everything else
 * Sangam has (dashboard, desks, landing page) redirects to the storefront.
 */

type Shop = "rail" | "bakery";

const hosts = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

function shopFor(req: NextRequest): Shop | null {
  const forced = process.env.SHOP_SITE?.trim();
  if (forced === "rail" || forced === "bakery") return forced;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  if (hosts(process.env.RAILKART_HOSTS).includes(host)) return "rail";
  if (hosts(process.env.BAKERY_HOSTS).includes(host)) return "bakery";
  return null;
}

/** Paths a shop site passes through untouched. */
const SHOP_PASSTHROUGH = ["/api/", "/verify", "/site/", "/icon.png", "/apple-icon.png", "/favicon.ico"];

/** The visitor's own origin (behind Railway's proxy the request URL is the internal one). */
function publicUrl(req: NextRequest, path: string): URL {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(path, host ? `${proto}://${host}` : req.url);
}

export function proxy(req: NextRequest) {
  const shop = shopFor(req);
  const { pathname } = req.nextUrl;

  if (!shop) {
    // Sangam itself: the standalone shop pages only make sense on a shop's own domain.
    if (pathname.startsWith("/site/")) return NextResponse.redirect(publicUrl(req, "/demo/shops"));
    return NextResponse.next();
  }

  if (pathname === "/") return NextResponse.rewrite(new URL(`/site/${shop}`, req.url));
  // The bakery's (hacked) invoice backend lives on the bakery's own site.
  if (shop === "bakery" && pathname === "/demo/shop/bakery/book") return NextResponse.next();
  if (SHOP_PASSTHROUGH.some((p) => pathname === p || pathname.startsWith(p))) {
    // Each shop site shows only its own storefront.
    if (pathname.startsWith("/site/") && pathname !== `/site/${shop}`) return NextResponse.redirect(publicUrl(req, "/"));
    return NextResponse.next();
  }
  return NextResponse.redirect(publicUrl(req, "/"));
}

export const config = {
  // Everything except Next's own static assets.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
