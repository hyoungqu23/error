// app/demo/boundaries/not-found/page.tsx — 서버 RSC에서 raise(NOT_FOUND).
// raise()는 code를 보고 Next의 notFound()를 호출한다(returns never) → not-found.tsx 렌더.
import { raise } from "error-next/server";
import { makeError } from "error-core";

export default function Page(): never {
  raise(makeError({ code: "NOT_FOUND", details: { resource: "demo-doc" } }));
}
