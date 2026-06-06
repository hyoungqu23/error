// 파이프라인 캡처 소유 마커(이식 설계 §Phase 0b) — Sentry 이중 캡처를 "사후 dedupe"가 아니라
// 호출 규약으로 차단한다: 파이프라인이 capture한 원본 에러를 WeakSet에 기록하고, 합성
// beforeSend가 그 에러의 "자동 캡처본"(파이프라인 태그 없는 이벤트)을 드롭한다.
// WeakSet인 이유: AppError는 순수 데이터(동결 가능)라 심볼 부착이 안전하지 않고,
// WeakSet은 원본 객체를 변형 없이 추적하며 GC를 막지 않는다.

/** 파이프라인이 소유(capture)한 원본 에러를 추적하는 모듈 레벨 WeakSet 1개. */
const captured = new WeakSet<object>();

/** 객체/함수일 때만 WeakSet에 기록한다(원시값은 WeakSet 키가 될 수 없으므로 무시). */
export const markPipelineCaptured = (input: unknown): void => {
  if (input !== null && (typeof input === "object" || typeof input === "function")) {
    captured.add(input as object);
  }
};

/** 입력이 파이프라인 캡처본으로 마킹됐는지 — 원시값은 항상 false. */
export const isPipelineCaptured = (input: unknown): boolean => {
  if (input === null || (typeof input !== "object" && typeof input !== "function")) return false;
  return captured.has(input as object);
};
