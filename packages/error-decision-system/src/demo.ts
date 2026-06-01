import {
  appError,
  createDecisionSystem,
  fail,
  ok,
  type ErrorCatalog,
  type OperationCatalog,
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
    detailsExposure: "allowlist",
    detailsAllowlist: ["fieldErrors", "field"],
    validateDetails: (details) => isRecord(details) && "fieldErrors" in details,
  },
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS",
    category: "business",
    sensitivity: "auth",
    defaultHttpStatus: 401,
    defaultRetryable: false,
    defaultMessageKey: "error.invalidCredentials",
    detailsExposure: "none",
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED",
    category: "business",
    sensitivity: "auth",
    defaultHttpStatus: 401,
    defaultRetryable: false,
    defaultMessageKey: "error.authRequired",
    detailsExposure: "none",
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    category: "business",
    sensitivity: "permission",
    defaultHttpStatus: 403,
    defaultRetryable: false,
    defaultMessageKey: "error.forbidden",
    detailsExposure: "none",
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    category: "business",
    sensitivity: "public",
    defaultHttpStatus: 404,
    defaultRetryable: false,
    defaultMessageKey: "error.notFound",
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
    detailsExposure: "none",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    category: "operational",
    sensitivity: "public",
    defaultHttpStatus: 429,
    defaultRetryable: true,
    defaultMessageKey: "error.rateLimited",
    detailsExposure: "none",
  },
  PAYMENT_FAILED: {
    code: "PAYMENT_FAILED",
    category: "business",
    sensitivity: "business-sensitive",
    defaultHttpStatus: 402,
    defaultRetryable: true,
    defaultMessageKey: "error.paymentFailed",
    detailsExposure: "allowlist",
    detailsAllowlist: ["providerCode"],
    validateDetails: (details) => details === null || isRecord(details),
  },
  SCHEMA_MISMATCH: {
    code: "SCHEMA_MISMATCH",
    category: "fault",
    sensitivity: "internal",
    defaultHttpStatus: 502,
    defaultRetryable: false,
    defaultMessageKey: "error.schemaMismatch",
    detailsExposure: "none",
  },
  UNKNOWN_SERVER_ERROR: {
    code: "UNKNOWN_SERVER_ERROR",
    category: "fault",
    sensitivity: "internal",
    defaultHttpStatus: 500,
    defaultRetryable: false,
    defaultMessageKey: "error.unknown",
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
});

export const messages: Record<string, string> = {
  "error.validation": "입력값을 확인해주세요.",
  "error.invalidCredentials": "이메일 또는 비밀번호를 확인해주세요.",
  "error.authRequired": "다시 로그인해주세요.",
  "error.forbidden": "이 작업을 수행할 권한이 없습니다.",
  "error.notFound": "요청한 대상을 찾지 못했습니다.",
  "error.timeout": "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
  "error.rateLimited": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "error.paymentFailed": "결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.schemaMismatch": "페이지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
  "error.unknown": "요청을 처리하지 못했습니다. 문제가 계속되면 지원 코드와 함께 문의해주세요.",
};

export const translate = (messageKey: string): string => messages[messageKey] ?? messages["error.unknown"]!;

export const loginAction = decisionSystem.defineFormAction("auth.login", async (input: { email: string }) => {
  if (!input.email.includes("@")) {
    return fail("VALIDATION", { fieldErrors: { email: ["이메일 형식을 확인해주세요."] }, field: "email" }, { fieldPath: "email" });
  }
  return fail("INVALID_CREDENTIALS");
});

export const checkoutAction = decisionSystem.defineFormAction("checkout.pay", async () =>
  fail("PAYMENT_FAILED", { providerCode: "PENDING_CONFIRMATION", rawProviderPayload: "redacted" }, { userCanRetry: false }),
);

export const productQuery = decisionSystem.defineQuery("product.read", async (input: { id: string }) => {
  if (input.id === "missing") throw appError("NOT_FOUND", { resource: "product" });
  if (input.id === "schema") throw appError("SCHEMA_MISMATCH", { rawShape: "internal-contract" });
  return { id: input.id, name: "Decision System Handbook" };
});

export const backgroundPrefetch = decisionSystem.defineBackgroundTask("profile.prefetch", async () => {
  throw appError("TIMEOUT", null, { userCanRetry: true });
});

export const adminPage = decisionSystem.protectedPage("admin.users", async () => {
  throw appError("FORBIDDEN");
});

export const demoScenarios = async () => {
  const validation = await loginAction({ email: "invalid" });
  const login = await loginAction({ email: "user@example.com" });
  const checkout = await checkoutAction({});
  const notFound = await productQuery({ id: "missing" });
  const schema = await productQuery({ id: "schema" });
  const background = await backgroundPrefetch();
  const forbidden = await adminPage();
  const okProduct = await productQuery({ id: "book" });

  return [
    { label: "Signup validation", result: validation },
    { label: "Login failure", result: login },
    { label: "Checkout payment failure", result: checkout },
    { label: "Product not found", result: notFound },
    { label: "Schema mismatch", result: schema },
    { label: "Background prefetch", result: background },
    { label: "Admin forbidden", result: forbidden },
    { label: "Successful query", result: ok(okProduct.ok ? okProduct.data : null) },
  ];
};
