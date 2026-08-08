import { Data } from "effect";

// 認証サービス呼出の失敗を、consumer 側でドメインエラーと区別して扱えるようにする tagged error 群。
export class AuthServiceUnavailable extends Data.TaggedError("AuthServiceUnavailable")<{
  message: string;
  cause?: unknown;
}> {}

export class AuthServiceTimeout extends Data.TaggedError("AuthServiceTimeout")<{
  message: string;
  cause?: unknown;
}> {}

export class AuthServiceUnauthorized extends Data.TaggedError("AuthServiceUnauthorized")<{
  message: string;
}> {}
