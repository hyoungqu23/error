// error/raise.ts  (server-only)
// The bridge from a query's expected `DomainError` → the correct Next.js framework
// interrupt, so feature/read-DAL code stays declarative. This is how a query's
// expected error becomes the right HTTP page on the server.
import "server-only";
import { notFound, redirect, forbidden } from "next/navigation";
import type { DomainError } from "error-core/app-error";

export function raise(error: DomainError): never {
  switch (error.code) {
    case "NOT_FOUND":
      notFound();
    // falls through — notFound() returns `never`
    case "AUTH_REQUIRED":
      // G9 SEAM: the client useErrorHandler appends ?returnTo=<location.pathname+search>
      // on its redirect, but the server CANNOT read the client URL here — request.url
      // is the RSC/data request, not the user-visible address bar. So raise() redirects
      // to a bare "/login"; the login page resolves post-auth destination from session
      // (or the host wires a middleware that captures the original path into a cookie and
      // the login page reads it). Do NOT synthesize a returnTo from headers here.
      redirect("/login"); // production-safe 401
    // falls through — redirect() returns `never`
    case "FORBIDDEN":
      forbidden(); // gated behind experimental.authInterrupts; else redirect("/403")
    // falls through — forbidden() returns `never`
    default:
      throw error; // 500-class → error.tsx
  }
  // unreachable: notFound/redirect/forbidden return `never`
}
