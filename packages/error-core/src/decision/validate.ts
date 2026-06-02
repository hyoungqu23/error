// error-core/decision/validate.ts — 카탈로그 init-time 불변식. 출처: EDS index.ts (validateCatalog).
// baselineDisclosureLevels: 원본 EDS index.ts:385-399 로직 그대로 이식
// (public → [] ; public 코드는 "specific" 기준이라 safe messageKey 요구 없음)
import type { ErrorCatalog, ErrorSemantics, DisclosureLevel } from "./types";

const baselineDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  if (semantics.category === "fault") return ["generic", "support-only"];
  switch (semantics.sensitivity) {
    case "public":
      return [];
    case "auth":
    case "permission":
    case "business-sensitive":
      return ["safe-vague"];
    case "pii":
      return ["safe-vague", "support-only"];
    case "internal":
      return ["generic"];
  }
};

const reachableDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  const levels = new Set<DisclosureLevel>(baselineDisclosureLevels(semantics));
  for (const level of Object.values(semantics.disclosureByUiScope ?? {})) {
    if (level) levels.add(level);
  }
  for (const level of Object.values(semantics.disclosureByResource ?? {})) {
    if (level) levels.add(level);
  }
  levels.delete("specific");
  return [...levels];
};

export { reachableDisclosureLevels };

export const validateCatalog = (errors: ErrorCatalog, fallbackErrorCode: string): void => {
  if (!errors[fallbackErrorCode]) {
    throw new Error(`[error-core/decision] fallbackErrorCode "${fallbackErrorCode}" is not present in the error catalog.`);
  }
  const problems: string[] = [];
  for (const [code, semantics] of Object.entries(errors)) {
    for (const level of reachableDisclosureLevels(semantics)) {
      if (!semantics.messageKeys?.[level]) {
        problems.push(`  - "${code}" can resolve to disclosure "${level}" but has no messageKeys["${level}"]`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[error-core/decision] disclosure/messageKey invariant failed. Each error must define a safe messageKey for every disclosure level it can reach:\n${problems.join("\n")}`,
    );
  }
};
