import { createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { AuthService, UserService } from "./gen/auth/v1/auth_pb";

type ClientOptions = {
  transport: Transport;
};

export function createAuthClient(options: ClientOptions) {
  const authService = createClient(AuthService, options.transport);
  const userService = createClient(UserService, options.transport);
  return { authService, userService };
}

export function createServiceKeyInterceptor(serviceKey: string): Interceptor {
  return (next) => async (req) => {
    req.header.set("X-Service-Key", serviceKey);
    return next(req);
  };
}
