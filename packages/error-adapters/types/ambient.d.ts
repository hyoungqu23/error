// `server-only`은 클라이언트 번들에 들어가면 throw하는 실제 패키지지만,
// 타입은 제공하지 않는다. tsc가 모듈 지정자를 해소할 수 있도록 선언만 둔다.
declare module "server-only";
