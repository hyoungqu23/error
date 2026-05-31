// error/policy.ts — the policy vocabulary (carried from the series, extended)
// r5: `UxAction` → `PresentAction`. The old `none` is SPLIT: business inline errors
// use `inline` (rendered next to the field/form, no presenter), truly-silent like
// REQUEST_ABORTED use `silent` (no presenter, no breadcrumb).
export type PresentAction = "inline" | "toast" | "alert" | "redirect" | "page" | "silent";
export type LogLevel = "fatal" | "error" | "warning" | "info" | "none";
export type HttpStatus = 400 | 401 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;

/**
 * Intent axis (r5). Replaces the boolean `expected`:
 *   business    — a meaningful, expected outcome (Track-1 / Result selector; was expected:true)
 *   operational — an environmental/transient failure (still "operational", non-fault)
 *   fault       — an unexpected defect (was the non-operational subset of expected:false)
 */
export type ErrorKind = "business" | "operational" | "fault";
