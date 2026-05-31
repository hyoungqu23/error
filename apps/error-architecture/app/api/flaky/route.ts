// app/api/flaky/route.ts — networkBoundary의 두 분기를 시연하는 라우트 핸들러.
//   · mode=ok        → 200 정상 JSON(클라가 Zod로 검증)
//   · mode=notfound  → 404 + 우리 프로토콜을 말하는 SerializedError(code+message+details)
//                      → networkBoundary가 NOT_FOUND 코드를 그대로 보존(retryable:false → 재시도 X)
//   · mode=ratelimit → 429 + Retry-After:3, opaque body → RATE_LIMITED(retryAfterMs)로 매핑, 재시도
//   · mode=server    → 500 opaque → HTTP_SERVER_ERROR(retryable:true)로 매핑, 백오프 재시도
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const mode = new URL(req.url).searchParams.get("mode") ?? "ok";
  const correlationId = req.headers.get("x-request-id");
  const headers: Record<string, string> = {};
  if (correlationId) headers["x-request-id"] = correlationId;

  switch (mode) {
    case "ok":
      return Response.json(
        { id: "doc_42", title: "정상 문서", items: ["alpha", "beta", "gamma"] },
        { headers },
      );

    case "notfound":
      // 서버-신뢰 경로: SerializedError(message 포함)를 보내면 networkBoundary가 코드를 보존한다.
      return Response.json(
        { code: "NOT_FOUND", message: "doc not found", details: { resource: "doc_42" } },
        { status: 404, headers },
      );

    case "ratelimit":
      return Response.json(
        { error: "rate limited" },
        { status: 429, headers: { ...headers, "retry-after": "3" } },
      );

    case "server":
      return Response.json({ error: "internal" }, { status: 500, headers });

    default:
      return Response.json({ error: "unknown mode" }, { status: 400, headers });
  }
}
