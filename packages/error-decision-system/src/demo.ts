import {
  appError,
  createDecisionSystem,
  fail,
  ok,
  type DecisionFailure,
  type DecisionResult,
  type ErrorCatalog,
  type OperationCatalog,
  type ReporterSink,
  type TelemetryContext,
} from "./index";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const DEMO_ERRORS = {
  VALIDATION: {
    code: "VALIDATION",
    category: "business",
    sensitivity: "public",
    defaultHttpStatus: 422,
    defaultRetryable: false,
    defaultMessageKey: "error.validation",
    defaultAction: "fix-input",
    telemetryBySurface: {
      field: { capture: false, level: "info", breadcrumb: false, alert: false },
    },
    detailsExposure: "allowlist",
    detailsAllowlist: ["fieldErrors", "field"],
    validateDetails: (details: unknown): details is { fieldErrors: Record<string, string[]>; field?: string } =>
      isRecord(details) && "fieldErrors" in details,
  },
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS",
    category: "business",
    sensitivity: "auth",
    defaultHttpStatus: 401,
    defaultRetryable: false,
    defaultMessageKey: "error.invalidCredentials",
    messageKeys: {
      "safe-vague": "error.invalidCredentials.safe",
    },
    defaultAction: "fix-input",
    detailsExposure: "none",
    // No client-safe details for an auth failure: declaring `null` makes
    // `system.fail("INVALID_CREDENTIALS", { anything })` a compile error.
    validateDetails: (details: unknown): details is null => details === null,
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED",
    category: "business",
    sensitivity: "auth",
    defaultHttpStatus: 401,
    defaultRetryable: false,
    defaultMessageKey: "error.authRequired",
    messageKeys: {
      "safe-vague": "error.authRequired.safe",
    },
    defaultAction: "login",
    redirectTarget: "/login",
    detailsExposure: "none",
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    category: "business",
    sensitivity: "permission",
    defaultHttpStatus: 403,
    defaultRetryable: false,
    defaultMessageKey: "error.forbidden",
    messageKeys: {
      "safe-vague": "error.forbidden.safe",
    },
    defaultAction: "request-access",
    detailsExposure: "none",
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    category: "business",
    sensitivity: "public",
    defaultHttpStatus: 404,
    defaultRetryable: false,
    defaultMessageKey: "error.notFound",
    messageKeys: {
      "safe-vague": "error.notFound.safe",
    },
    disclosureByUiScope: {
      page: "safe-vague",
    },
    disclosureByResource: {
      collection: "specific",
      product: "safe-vague",
    },
    actionByResource: {
      product: "go-back",
    },
    actionByUiScope: {
      page: "go-back",
    },
    defaultAction: "none",
    surfaceByResource: {
      collection: "empty",
      product: "page",
    },
    detailsExposure: "allowlist",
    detailsAllowlist: ["resource"],
  },
  TIMEOUT: {
    code: "TIMEOUT",
    category: "operational",
    sensitivity: "internal",
    defaultHttpStatus: 504,
    defaultRetryable: true,
    defaultMessageKey: "error.timeout",
    messageKeys: {
      generic: "error.timeout.generic",
      // On a user-facing form (e.g. checkout) a timeout is presented as a safe-vague
      // "we couldn't confirm" rather than a generic internal failure — matches the matrix.
      "safe-vague": "error.timeout.safe",
    },
    disclosureByUiScope: {
      form: "safe-vague",
    },
    detailsExposure: "none",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    category: "operational",
    sensitivity: "public",
    defaultHttpStatus: 429,
    defaultRetryable: true,
    defaultMessageKey: "error.rateLimited",
    defaultAction: "wait",
    detailsExposure: "none",
  },
  PAYMENT_FAILED: {
    code: "PAYMENT_FAILED",
    category: "business",
    sensitivity: "business-sensitive",
    defaultHttpStatus: 402,
    defaultRetryable: true,
    defaultMessageKey: "error.paymentFailed",
    messageKeys: {
      "safe-vague": "error.paymentFailed.safe",
    },
    detailsExposure: "allowlist",
    detailsAllowlist: ["providerCode"],
    validateDetails: (details: unknown): details is { providerCode?: string } | null =>
      details === null || isRecord(details),
  },
  SCHEMA_MISMATCH: {
    code: "SCHEMA_MISMATCH",
    category: "fault",
    sensitivity: "internal",
    defaultHttpStatus: 502,
    defaultRetryable: false,
    defaultMessageKey: "error.schemaMismatch",
    messageKeys: {
      "support-only": "error.schemaMismatch.support",
      generic: "error.unknown",
    },
    detailsExposure: "none",
  },
  UNKNOWN_SERVER_ERROR: {
    code: "UNKNOWN_SERVER_ERROR",
    category: "fault",
    sensitivity: "internal",
    defaultHttpStatus: 500,
    defaultRetryable: false,
    defaultMessageKey: "error.unknown",
    messageKeys: {
      "support-only": "error.unknown.support",
      generic: "error.unknown",
    },
    detailsExposure: "none",
  },
} as const satisfies ErrorCatalog;

export const DEMO_OPERATIONS = {
  "auth.login": {
    operation: "auth.login",
    owner: "security",
    criticality: "security",
    defaultUiScope: "form",
    piiRisk: true,
  },
  "auth.signup": {
    operation: "auth.signup",
    owner: "growth",
    criticality: "security",
    defaultUiScope: "form",
    piiRisk: true,
  },
  "checkout.pay": {
    operation: "checkout.pay",
    owner: "payments",
    criticality: "revenue",
    defaultUiScope: "form",
    piiRisk: true,
  },
  "product.read": {
    operation: "product.read",
    owner: "catalog",
    criticality: "core",
    defaultUiScope: "page",
    piiRisk: false,
  },
  "search.products": {
    operation: "search.products",
    owner: "search",
    criticality: "normal",
    defaultUiScope: "component",
    piiRisk: false,
  },
  "profile.prefetch": {
    operation: "profile.prefetch",
    owner: "growth",
    criticality: "low",
    defaultUiScope: "background",
    piiRisk: false,
  },
  "admin.users": {
    operation: "admin.users",
    owner: "admin",
    criticality: "security",
    defaultUiScope: "page",
    piiRisk: true,
  },
} as const satisfies OperationCatalog;

export const decisionSystem = createDecisionSystem({
  errors: DEMO_ERRORS,
  operations: DEMO_OPERATIONS,
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  validationErrorCode: "VALIDATION",
});

export const messages: Record<string, string> = {
  "error.validation": "입력값을 확인해주세요.",
  "error.invalidCredentials": "이메일 또는 비밀번호를 확인해주세요.",
  "error.invalidCredentials.safe": "이메일 또는 비밀번호를 확인해주세요.",
  "error.authRequired": "다시 로그인해주세요.",
  "error.authRequired.safe": "다시 로그인해주세요.",
  "error.forbidden": "이 작업을 수행할 권한이 없습니다.",
  "error.forbidden.safe": "접근할 수 없는 페이지입니다.",
  "error.notFound": "요청한 대상을 찾지 못했습니다.",
  "error.notFound.safe": "요청한 페이지를 찾지 못했습니다.",
  "error.timeout": "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
  "error.timeout.generic": "일시적으로 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.timeout.safe": "처리 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.",
  "error.rateLimited": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "error.paymentFailed": "결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.paymentFailed.safe": "결제를 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.schemaMismatch": "페이지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.schemaMismatch.support": "페이지를 불러오지 못했습니다. 지원 코드와 함께 문의해주세요.",
  "error.unknown": "요청을 처리하지 못했습니다. 문제가 계속되면 지원 코드와 함께 문의해주세요.",
  "error.unknown.support": "요청을 처리하지 못했습니다. 지원 코드와 함께 문의해주세요.",
};

export const translate = (messageKey: string): string => messages[messageKey] ?? messages["error.unknown"]!;

export const loginAction = decisionSystem.defineFormAction("auth.login", async (input: { email: string }) => {
  if (!input.email.includes("@")) {
    return fail("VALIDATION", { fieldErrors: { email: ["이메일 형식을 확인해주세요."] }, field: "email" }, { fieldPath: "email" });
  }
  return fail("INVALID_CREDENTIALS");
});

// Minimal vendor-neutral schema (zod-compatible shape: `.parse` throws with `.flatten()`).
interface SignupInput {
  email: string;
  password: string;
}

const signupSchema = {
  parse(input: unknown): SignupInput {
    const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    const fieldErrors: Record<string, string[]> = {};
    if (typeof value.email !== "string" || !value.email.includes("@")) {
      fieldErrors.email = ["이메일 형식을 확인해주세요."];
    }
    if (typeof value.password !== "string" || value.password.length < 8) {
      fieldErrors.password = ["비밀번호는 8자 이상이어야 합니다."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      const error = new Error("validation failed") as Error & { flatten: () => unknown };
      error.flatten = () => ({ fieldErrors, formErrors: [] });
      throw error;
    }
    return { email: value.email as string, password: value.password as string };
  },
};

// 3-arg form action: the schema parses input before the handler runs; a parse failure becomes
// a VALIDATION decision (validationErrorCode) with client-safe fieldErrors — no manual check.
export const signupAction = decisionSystem.defineFormAction("auth.signup", signupSchema, async (input) => {
  return ok({ id: "u_1", email: input.email });
});

// Non-idempotent submit the user *could* retry: the system refuses to auto-retry (double-charge
// risk) and downgrades to a confirm dialog with a "wait" action — idempotent axis is now live.
export const checkoutAction = decisionSystem.defineFormAction("checkout.pay", async () =>
  fail("PAYMENT_FAILED", { providerCode: "PENDING_CONFIRMATION", rawProviderPayload: "redacted" }, {
    userCanRetry: true,
    occurrence: { idempotent: false },
  }),
);

export const productQuery = decisionSystem.defineQuery("product.read", async (input: { id: string }) => {
  if (input.id === "missing") throw appError("NOT_FOUND", { resource: "product" }, { occurrence: { resource: "product" } });
  if (input.id === "schema") throw appError("SCHEMA_MISMATCH", { rawShape: "internal-contract" });
  return { id: input.id, name: "Decision System Handbook" };
});

export const searchProducts = decisionSystem.defineQuery("search.products", async (input: { query: string }) => {
  if (input.query === "empty") throw appError("NOT_FOUND", { resource: "collection" }, { occurrence: { resource: "collection" } });
  return [{ id: "book", name: "Decision System Handbook" }];
});

export const backgroundPrefetch = decisionSystem.defineBackgroundTask("profile.prefetch", async () => {
  throw appError("TIMEOUT", null, { userCanRetry: true });
});

export const adminPage = decisionSystem.protectedPage("admin.users", async () => {
  throw appError("FORBIDDEN");
});

export interface DemoTelemetryEvent {
  type: "capture" | "breadcrumb" | "alert";
  code: string;
  operation: string;
  level: string;
  sampleRate?: number;
  fingerprint?: readonly string[];
  tags?: Record<string, string>;
}

export interface DemoScenario {
  label: string;
  situation: string;
  developerCode: string;
  expectedUser: string;
  expectedTelemetry: string;
  result: DecisionResult<unknown>;
  telemetryEvents: DemoTelemetryEvent[];
}

const collectTelemetryEvents = (failure: DecisionFailure): DemoTelemetryEvent[] => {
  const events: DemoTelemetryEvent[] = [];
  const runtime = failure.decision.telemetry.tags?.runtime === "server" ? "server" : "client";
  const ctx: TelemetryContext = {
    runtime,
    operation: failure.occurrence.operation,
  };
  const push = (type: DemoTelemetryEvent["type"]): void => {
    events.push({
      type,
      code: failure.error.code,
      operation: failure.occurrence.operation,
      level: failure.decision.telemetry.level,
      sampleRate: failure.decision.telemetry.sampleRate,
      fingerprint: failure.decision.telemetry.fingerprint,
      tags: failure.decision.telemetry.tags,
    });
  };
  const reporter: ReporterSink = {
    capture: () => push("capture"),
    breadcrumb: () => push("breadcrumb"),
  };
  decisionSystem.executeTelemetryDecision(failure.error, failure.decision.telemetry, ctx, {
    reporter,
    notifier: { alert: () => push("alert") },
  });
  return events;
};

const withTelemetry = (result: DecisionResult<unknown>): DemoTelemetryEvent[] =>
  result.ok ? [] : collectTelemetryEvents(result);

export const demoScenarios = async (): Promise<DemoScenario[]> => {
  const validation = await loginAction({ email: "invalid" });
  const signup = await signupAction({ email: "bad", password: "short" });
  const login = await loginAction({ email: "user@example.com" });
  const checkout = await checkoutAction({});
  const notFound = await productQuery({ id: "missing" });
  const emptySearch = await searchProducts({ query: "empty" });
  const schema = await productQuery({ id: "schema" });
  const background = await backgroundPrefetch();
  const forbidden = await adminPage();
  const okProduct = await productQuery({ id: "book" });

  return [
    {
      label: "Field validation",
      situation: "로그인 폼에서 이메일 형식이 틀린 recoverable business failure",
      developerCode:
        'return fail("VALIDATION", { fieldErrors, field: "email" }, { fieldPath: "email" });',
      expectedUser: "필드 오류로 표시하고 사용자는 입력을 고친다.",
      expectedTelemetry: "일상적인 입력 오류이므로 capture/breadcrumb/alert를 만들지 않는다.",
      result: validation,
      telemetryEvents: withTelemetry(validation),
    },
    {
      label: "Signup schema validation",
      situation: "회원가입 폼에서 입력 schema 검증 실패 (3-arg defineFormAction)",
      developerCode: 'defineFormAction("auth.signup", schema, handler) // schema.parse 실패 시 자동 VALIDATION',
      expectedUser: "schema가 만든 fieldErrors를 form surface로 표시한다. handler는 실행되지 않는다.",
      expectedTelemetry: "일상적인 입력 오류이므로 capture/alert를 만들지 않는다.",
      result: signup,
      telemetryEvents: withTelemetry(signup),
    },
    {
      label: "Invalid credentials",
      situation: "로그인 시 인증 실패. 원인은 틀린 비밀번호일 수도, 없는 계정일 수도 있음",
      developerCode: 'return fail("INVALID_CREDENTIALS");',
      expectedUser: "safe-vague copy로 계정 존재 여부를 숨긴다.",
      expectedTelemetry: "security operation의 business event로 breadcrumb와 warning capture를 만든다.",
      result: login,
      telemetryEvents: withTelemetry(login),
    },
    {
      label: "Checkout payment failure",
      situation: "결제 operation에서 provider 상태 확인 실패 (non-idempotent)",
      developerCode:
        'return fail("PAYMENT_FAILED", { providerCode }, { userCanRetry: true, occurrence: { idempotent: false } });',
      expectedUser: "중복 결제를 막기 위해 자동 retry 대신 dialog surface + wait action으로 사용자 확인을 요구한다.",
      expectedTelemetry: "revenue-critical warning capture와 breadcrumb를 남긴다.",
      result: checkout,
      telemetryEvents: withTelemetry(checkout),
    },
    {
      label: "Product detail not found",
      situation: "상세 페이지 query에서 product resource를 찾지 못함",
      developerCode:
        'throw appError("NOT_FOUND", { resource: "product" }, { occurrence: { resource: "product" } });',
      expectedUser: "상세 페이지는 page surface + go-back action으로 처리한다.",
      expectedTelemetry: "core product page의 business failure로 breadcrumb/capture 정책을 적용한다.",
      result: notFound,
      telemetryEvents: withTelemetry(notFound),
    },
    {
      label: "Empty search results",
      situation: "검색 query에서 collection 결과가 없음",
      developerCode:
        'throw appError("NOT_FOUND", { resource: "collection" }, { occurrence: { resource: "collection" } });',
      expectedUser: "같은 NOT_FOUND라도 search collection에서는 empty state로 처리한다.",
      expectedTelemetry: "정상적인 빈 결과에 가까워 alert 없이 breadcrumb 중심으로 처리한다.",
      result: emptySearch,
      telemetryEvents: withTelemetry(emptySearch),
    },
    {
      label: "Schema mismatch",
      situation: "서버/클라이언트 계약이 깨져 product page query가 실패",
      developerCode: 'throw appError("SCHEMA_MISMATCH", { rawShape: "internal-contract" });',
      expectedUser: "내부 details는 숨기고 support-only message와 support code를 제공한다.",
      expectedTelemetry: "core page fault이므로 error/fatal capture와 alert 후보가 된다.",
      result: schema,
      telemetryEvents: withTelemetry(schema),
    },
    {
      label: "Background prefetch timeout",
      situation: "사용자가 기다리지 않는 profile prefetch가 timeout",
      developerCode: 'throw appError("TIMEOUT", null, { userCanRetry: true });',
      expectedUser: "background/silent surface라 사용자에게 아무것도 띄우지 않는다.",
      expectedTelemetry: "low criticality operational event로 sampleRate만 결정하고 capture는 만들지 않는다.",
      result: background,
      telemetryEvents: withTelemetry(background),
    },
    {
      label: "Admin forbidden",
      situation: "보호된 관리자 페이지에서 권한 부족",
      developerCode: 'throw appError("FORBIDDEN");',
      expectedUser: "page-level safe-vague message와 request-access action을 제공한다.",
      expectedTelemetry: "security-critical business event로 warning capture와 breadcrumb를 남긴다.",
      result: forbidden,
      telemetryEvents: withTelemetry(forbidden),
    },
    {
      label: "Successful query",
      situation: "정상적인 product query",
      developerCode: 'return { id: input.id, name: "Decision System Handbook" };',
      expectedUser: "에러 decision 없이 성공 데이터를 렌더링한다.",
      expectedTelemetry: "에러 telemetry를 실행하지 않는다.",
      result: ok(okProduct.ok ? okProduct.data : null),
      telemetryEvents: [],
    },
  ];
};
