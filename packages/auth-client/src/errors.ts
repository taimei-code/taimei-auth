import { Data } from "effect";

// 認証サービスの呼び出しの失敗を、consumer 側でドメインエラーと区別して扱えるようにする tagged error の一式。
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
