// error/schema.ts
import { z } from "zod";
import type { ErrorCode } from "./registry";

export const ErrorDetailsSchema = {
  VALIDATION:           z.object({ fieldErrors: z.record(z.array(z.string())) }),
  INVALID_CREDENTIALS:  z.null(),
  AUTH_REQUIRED:        z.null(),
  FORBIDDEN:            z.object({ requiredRole: z.string().optional() }).nullable(),
  NOT_FOUND:            z.object({ resource: z.string().optional() }).nullable(),
  OFFLINE:              z.null(),
  TIMEOUT:              z.null(),
  REQUEST_ABORTED:      z.null(),
  NETWORK_ERROR:        z.null(),
  HTTP_CLIENT_ERROR:    z.object({ status: z.number() }).nullable(),
  RATE_LIMITED:         z.object({ retryAfterMs: z.number().int().nonnegative().optional() }).nullable(),
  HTTP_SERVER_ERROR:    z.object({ status: z.number() }).nullable(),
  SCHEMA_MISMATCH:      z.object({ endpoint: z.string().optional() }).nullable(),
  UNKNOWN_SERVER_ERROR: z.null(),
  UNKNOWN_CLIENT_ERROR: z.null(),
} as const satisfies Record<ErrorCode, z.ZodTypeAny>;

export type ErrorDetailsMap = { [K in ErrorCode]: z.infer<(typeof ErrorDetailsSchema)[K]> };
