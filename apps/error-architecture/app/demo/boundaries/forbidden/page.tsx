// app/demo/boundaries/forbidden/page.tsx — 서버 RSC에서 raise(FORBIDDEN).
// raise()가 Next의 forbidden()을 호출(experimental.authInterrupts) → forbidden.tsx(403) 렌더.
// requiredRole은 details 허용목록에서 막혀 클라이언트로 누출되지 않는다.
import { raise } from "error-next/server";
import { makeError } from "error-core";

export default function Page(): never {
  raise(makeError({ code: "FORBIDDEN", details: { requiredRole: "admin" } }));
}
