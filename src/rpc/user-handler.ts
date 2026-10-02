import type { ConnectRouter } from "@connectrpc/connect";
import { Effect } from "effect";
import { UserRepo } from "../account/ports";
import { UserService } from "../gen/auth/v1/auth_pb";
import { userResponse } from "./mappers";
import { runRpc } from "./run-rpc";

export function registerUserService(router: ConnectRouter) {
  router.service(UserService, {
    findUserByEmail: (req) =>
      runRpc(
        UserRepo.use((users) => users.findUserByEmail(req.email)).pipe(Effect.map(userResponse)),
      ),

    findUserById: (req) =>
      runRpc(
        UserRepo.use((users) => users.findUserById(req.userId)).pipe(Effect.map(userResponse)),
      ),
  });
}
