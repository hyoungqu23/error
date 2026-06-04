// error-next/server — G13 SERVER-ONLY 공개 표면.
// 서버 코드(Server Action·Route Handler·RSC DAL)가 reach하는 단일 import 경로.
// "server-only" 가드가 클라이언트의 잘못된 import를 런타임 누출이 아닌 BUILD 에러로 만든다.
// 이 모듈들은 node:async_hooks(활성 레지스트리 store), next/headers, pager 트랜스포트를
// 끌어오며 브라우저 번들에 들어가면 안 된다.
import "server-only";

// 뮤테이션 경계 — Track-1 Result / Track-2 report+rethrow.
export { safeServerAction } from "./safe-server-action";
export { safeFormAction, type FormState } from "./safe-form-action";

// 쿼리 → 프레임워크 인터럽트 다리(notFound/redirect/forbidden).
export { raise } from "./raise";

// 요청별 핸들러 + 컴포지션 루트 + 요청 범위 correlation id.
export {
  getRequestHandler,
  getRequestCorrelationId,
  serverDeps,
  serverReporter,
  type HandleServerError,
} from "./request-handler.server";

// Route Handler 에러 → HTTP Response 매퍼(messageless, details-gated body).
// request-handler가 errorSystem에 바인딩한 createErrorResponder 인스턴스를 재노출(단일 outbound 누출게이트).
export { errorResponder } from "./request-handler.server";

// 서버측 재시도(retryable 플래그 + Retry-After 존중).
// BackoffConfig/DEFAULT_BACKOFF는 error-core(backoff.ts)가 단일 출처 — 여기서 재노출하지 않는다.
export { withRetry, type WithRetryOptions } from "./with-retry";
