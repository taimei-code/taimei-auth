import { Code, ConnectError } from "@connectrpc/connect";
import type { Cause, Effect } from "effect";
import { Exit } from "effect";
import {
  parseClientFacingError,
  type RouteError,
  settleCause,
} from "../handlers/client-facing-error";
import { type AppServices, getRuntime } from "../runtime";

export type RpcEffect<A> = Effect.Effect<A, RouteError, AppServices>;

const STATUS_TO_CODE: Record<number, Code> = {
  400: Code.InvalidArgument,
  401: Code.Unauthenticated,
  403: Code.PermissionDenied,
  404: Code.NotFound,
  409: Code.FailedPrecondition,
  410: Code.FailedPrecondition,
  429: Code.ResourceExhausted,
};

export const statusToCode = (status: number): Code => STATUS_TO_CODE[status] ?? Code.Internal;

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
  if (failure) return new ConnectError(failure.error, statusToCode(failure.status));
  // consumer は message を表示に使うため、"internal error" に置き換えない。
  return ConnectError.from(reported[0]);
}
