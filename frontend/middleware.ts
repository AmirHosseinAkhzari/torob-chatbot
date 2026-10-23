import { NextResponse, type NextRequest } from "next/server";

/** admin.<domain> opens the admin panel: its home is /admin (the other paths work as on the main site). */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  if (host.startsWith("admin.") && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/"] };
