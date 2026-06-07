// error-next/src/error-system.ts — error-next의 baseline DecisionSystem(정책 SSOT).
//
// P3e에서 active-registry/DEFAULT_ERROR_REGISTRY가 사라진 뒤, 정책의 단일 출처는
// createDecisionSystem으로 만든 DecisionSystem 인스턴스다 (D-P5-1, 옵션1: 내부 공유 baseline).
// 서버 root(request-handler.server)·클라 root(ErrorHandlerInit)가 이 인스턴스를 공유한다.
//
// client-safe: 순수 데이터/함수만 import한다 — server-only·next·벤더 SDK 없음 — 그래야
// 'use client' 컴포넌트(ErrorHandlerInit)에서도 평가 안전하다.
//
// 실제 도메인 operations 카탈로그는 P8에서 host 앱이 주입한다(ErrorHandlerInit/request-handler에
// optional system prop을 더하는 상위호환 경로). P5 un-red에는 이 baseline으로 충분하다.
import {
  createDecisionSystem,
  CANONICAL_ERROR_SEMANTICS,
  tryNormalizeKnownError,
  type OperationCatalog,
} from "error-core";

// Baseline operations — fallback 1개("unknown"). boundary들은 makeOccurrence 대신 occurrence를
// operation:"unknown"으로 직접 구성하므로 P5에서는 이 1개로 충분하다(도메인 operations는 P8).
const operations = {
  unknown: {
    operation: "unknown",
    owner: "platform",
    criticality: "normal",
    defaultUiScope: "page",
    piiRisk: false,
  },
} satisfies OperationCatalog;

// normalizeUnknown 주입: raw 프레임워크/네트워크 에러(AbortError→REQUEST_ABORTED,
// fetch TypeError→NETWORK_ERROR/OFFLINE, TimeoutError→TIMEOUT)를 networkBoundary를 우회한 raw
// catch 경로에서도 전용 operational 코드로 승격한다. tryNormalizeKnownError는 UNKNOWN_* 폴백을
// 가지지 않으므로(null 반환) 일반 Error·문자열 등은 각 시스템의 fallbackErrorCode로 떨어져 P2
// server/client 분리가 보존된다. decision/system은 카탈로그를 모르므로 promoter는 여기서만 주입한다.
//
// 신뢰 경계(크로스 모델 P1): 파이프라인 raw catch에 들어오는 promoter는 `Error 인스턴스`로만
// 좁힌다 — tryNormalizeKnownError 자체는 wire 재수화 분기(isSerializedError/isClientErrorPayload)를
// 포함하므로, 그대로 주입하면 서버 raw catch에 던져진 plain `{code,message}` 객체가 known-code
// AppError로 재수화돼 errorResponder의 HTTP status/retryable/redirect 결정을 "외부 형태 객체"가
// 선택할 수 있다(403 스푸핑 등). plain object의 wire 재수화는 networkBoundary(클라 응답을 신뢰하는
// 경로)와 normalizeToAppError 직접 소비자의 몫이지, 신뢰할 수 없는 입력을 받는 파이프라인 promoter의
// 책임이 아니다. Error만 통과시키면 mapKnownError(프레임워크/네트워크 매핑)만 살고 wire 분기는 닫힌다.
const normalizeUnknown = (input: unknown) =>
  input instanceof Error ? tryNormalizeKnownError(input) : null;

/** 서버 측 DecisionSystem(request-handler가 사용). 카탈로그가 모든 정책을 소유한다. */
export const errorSystem = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations,
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  normalizeUnknown,
});

/**
 * 클라이언트 측 DecisionSystem(ErrorHandlerInit/클라 컴포지션 루트가 사용) — fallback만 다르다.
 * (P2 리뷰: 단일 시스템의 UNKNOWN_SERVER_ERROR 고정 fallback이 브라우저 unknown 예외를
 *  서버 fault로 오분류하던 버그 수정.)
 */
export const clientErrorSystem = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations,
  fallbackErrorCode: "UNKNOWN_CLIENT_ERROR",
  normalizeUnknown,
});
