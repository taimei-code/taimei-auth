import { createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { AuthService, CompanyService, UserService } from "./gen/auth/v1/auth_pb";

type ClientOptions = {
  transport: Transport;
};

export function createAuthClient(options: ClientOptions) {
  const authService = createClient(AuthService, options.transport);
  const userService = createClient(UserService, options.transport);
  const companyService = createClient(CompanyService, options.transport);
  return { authService, userService, companyService };
}

export function createServiceKeyInterceptor(serviceKey: string): Interceptor {
  return (next) => async (req) => {
    req.header.set("X-Service-Key", serviceKey);
    return next(req);
  };
}
