import { Code, ConnectError } from "@connectrpc/connect";
import type { Cause, Effect } from "effect";
import { Exit } from "effect";
import type { WireStatus } from "../failure";
import {
  parseClientFacingError,
  type RouteError,
  settleCause,
} from "../handlers/client-facing-error";
import { type AppServices, getRuntime } from "../runtime";

export type RpcEffect<A> = Effect.Effect<A, RouteError, AppServices>;

const STATUS_TO_CODE: Record<WireStatus, Code> = {
  400: Code.InvalidArgument,
  401: Code.Unauthenticated,
  403: Code.PermissionDenied,
  404: Code.NotFound,
  409: Code.FailedPrecondition,
  410: Code.FailedPrecondition,
  429: Code.ResourceExhausted,
  503: Code.Unavailable,
};

export const statusToCode = (status: WireStatus): Code => STATUS_TO_CODE[status];

export async function runRpc<A>(program: RpcEffect<A>): Promise<A> {
  const exit = await getRuntime().runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw causeToConnectError(exit.cause);
}

function causeToConnectError(cause: Cause.Cause<RouteError>): ConnectError {
  const { failure, reported } = settleCause(cause, parseClientFacingError, {
    label: "[runRpc]",
    tags: { handler: "runRpc" },
  });
  if (failure) return new ConnectError(failure.tag, statusToCode(failure.status));
  return ConnectError.from(reported[0]);
}
