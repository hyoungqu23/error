// proxy.ts — THE PROXY BOUNDARY (Node.js runtime), sits beside app/ (§9).
// This is a runtime-only filename: at runtime the framework invokes `proxy`; for the
// purposes of this module it is simply an exported function. It mints (or honors a
// well-formed inbound) x-request-id, forwards it as an INBOUND request header so RSC/
// DAL/actions read it via `await headers()`, echoes it on the response for
// observability, and seeds the client via a non-httpOnly cookie. `crypto.randomUUID`,
// `Headers`, and `NextResponse` are all valid here on the Node.js runtime.

import { NextResponse, type NextRequest } from "next/server";

const CORRELATION_HEADER = "x-request-id";
const CORRELATION_COOKIE = "x-correlation-id";
const ID_RE = /^[\w-]{8,64}$/;

export function proxy(req: NextRequest): NextResponse {
  // 1. Honor a well-formed inbound id (from an upstream LB/gateway); else mint.
  const incoming = req.headers.get(CORRELATION_HEADER);
  const correlationId =
    incoming && ID_RE.test(incoming) ? incoming : crypto.randomUUID();

  // 2. Clone inbound headers and set the id so it is visible to RSC/DAL/actions via
  //    `await headers()`. Passing request.headers to NextResponse.next rewrites the
  //    headers the app sees on THIS request — it does not create a sub-request.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // 3. Echo on the response (observability) + non-httpOnly cookie (client seed).
  res.headers.set(CORRELATION_HEADER, correlationId);
  res.cookies.set(CORRELATION_COOKIE, correlationId, {
    httpOnly: false, // MUST be readable by client JS to seed Reporter context
    sameSite: "lax",
    path: "/",
  });

  return res;
}

// `config` is still the export the framework reads for path matching under proxy.ts.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
