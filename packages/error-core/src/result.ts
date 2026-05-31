// error/result.ts  (serialization-safe contract; client-bound payload is gated)
import type { DomainError } from "./app-error";
import { toClientSerialized, type ClientSerializedError } from "./serialize-client";

export type Success<T> = { ok: true; data: T };
export type Failure = { ok: false; error: ClientSerializedError };
export type Result<T> = Success<T> | Failure;
export const actionSuccess = <T>(data: T): Success<T> => ({ ok: true, data });
export const actionFailure = (e: DomainError): Failure => ({ ok: false, error: toClientSerialized(e) });
