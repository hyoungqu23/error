// error/runtime.ts
export type Runtime = "server" | "client";
export const getRuntime = (): Runtime => (typeof window === "undefined" ? "server" : "client");
