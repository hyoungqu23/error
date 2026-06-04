// error-next — Next.js(App Router) + React 통합의 클라이언트 안전 공개 표면.
//
// `error-core`의 클라이언트 안전 표면을 전량 재노출하고(동일 모듈 인스턴스 → 클라이언트
// 싱글턴 sink가 공유됨), 그 위에 React/Next 전용 진입점을 더한다. 서버 전용 표면(Server
// Action·Route Handler·요청별 핸들러)은 `error-next/server`에 분리되어 있다.

// 1) core의 클라이언트 안전 표면 전량 재노출(makeError, Result, resolveErrorMessage,
//    handleError/initHandleError, isAppError, fieldErrorsFromError, 텔레메트리 계약 …).
export * from "error-core";

// 2) React/Next 클라이언트 통합.
export { useErrorHandler } from "./use-error-handler";
export {
  makeQueryClient,
  createAppQueryClient,
  buildQueryClientConfig,
  shouldRetryQuery,
  MAX_QUERY_RETRIES,
} from "./query-client";
export { ErrorFallback } from "./components/ErrorFallback";
export { ErrorHandlerInit } from "./components/ErrorHandlerInit";
