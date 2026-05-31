// ============================================================================
// error/safe-handler.ts — 인터랙션 경계 (§8.2)
// Wraps an event handler so a thrown error funnels into the single client sink.
// ============================================================================
import { handleError } from "./handler";

export const safeHandler =
  <Args extends unknown[]>(fn: (...a: Args) => void | Promise<void>) =>
  async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (e) {
      handleError(e);
    }
  };
