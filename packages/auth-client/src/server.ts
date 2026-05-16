import {
  createClient,
  ConnectError,
  Code,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { AuthService, UserService } from "./gen/auth/v1/auth_pb";
import { AuthServiceUnavailable, AuthServiceTimeout, AuthServiceUnauthorized } from "./errors";

type ClientOptions = {
  transport: Transport;
};

export function createAuthClient(options: ClientOptions) {
  const authService = createClient(AuthService, options.transport);
  const userService = createClient(UserService, options.transport);
  return { authService, userService };
}

// Service Key header (`X-Service-Key`) は taimei-auth IdP の private contract。
// ADR-004 の Cookie 名と同格の隠蔽対象で、consumer は header 名を直接書かないこと (ADR-007 §3)。
export function createServiceKeyInterceptor(serviceKey: string): Interceptor {
  return (next) => async (req) => {
    req.header.set("X-Service-Key", serviceKey);
    return next(req);
  };
}

export function mapConnectError(
  error: unknown,
): AuthServiceUnavailable | AuthServiceTimeout | AuthServiceUnauthorized {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.Unavailable:
        return new AuthServiceUnavailable({
          message: "認証サービスに接続できません",
          cause: error,
        });
      case Code.DeadlineExceeded:
        return new AuthServiceTimeout({
          message: "認証サービスがタイムアウトしました",
          cause: error,
        });
      case Code.Unauthenticated:
        return new AuthServiceUnauthorized({
          message: "サービス認証に失敗しました",
        });
      default:
        return new AuthServiceUnavailable({
          message: `認証サービスエラー: ${error.message}`,
          cause: error,
        });
    }
  }

  return new AuthServiceUnavailable({
    message: "認証サービスとの通信で予期しないエラーが発生しました",
    cause: error,
  });
}
