import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "./lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/public") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.user_id) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
