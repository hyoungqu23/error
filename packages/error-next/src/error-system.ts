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
import { createDecisionSystem, CANONICAL_ERROR_SEMANTICS, type OperationCatalog } from "error-core";

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

/** 서버 측 DecisionSystem(request-handler가 사용). 카탈로그가 모든 정책을 소유한다. */
export const errorSystem = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations,
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
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
});
