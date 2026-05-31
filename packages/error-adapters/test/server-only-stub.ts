// vitest용 `server-only` 스텁(vitest.config.ts에서 alias). 실제 패키지는 클라이언트
// 번들에서 throw하므로, Node에서 server 모듈을 단위 테스트할 때 지정자만 해소되면 된다.
export {};
