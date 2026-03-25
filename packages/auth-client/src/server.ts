import { createClient, ConnectError, Code } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  AuthService,
  UserService,
} from "./gen/auth/v1/auth_pb";
import {
  AuthServiceUnavailable,
  AuthServiceTimeout,
  AuthServiceUnauthorized,
} from "./errors";

type ClientOptions = {
  baseUrl: string;
  serviceKey?: string;
};

export function createAuthClient(options: ClientOptions) {
  const transport = createConnectTransport({
    httpVersion: "1.1",
    baseUrl: options.baseUrl,
    interceptors: [
      (next) => async (req) => {
        if (options.serviceKey) {
          req.header.set("X-Service-Key", options.serviceKey);
        }
        return next(req);
      },
    ],
  });

  const authService = createClient(AuthService, transport);
  const userService = createClient(UserService, transport);

  return { authService, userService };
}

// ConnectError → TaggedError 変換
export function mapConnectError(error: unknown): AuthServiceUnavailable | AuthServiceTimeout | AuthServiceUnauthorized {
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
