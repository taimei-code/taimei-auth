import { Data } from "effect";

// 認証サービスの通信障害を表すインフラエラー (consumer 側でドメインエラーと区別してハンドリング)
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
