import { Code, ConnectError } from "@connectrpc/connect";
import type { Cause, Effect } from "effect";
import { Data, Exit } from "effect";
import type { BoundaryError } from "../errors";
import {
  parseWireShaped,
  type RouteError,
  settleCause,
  type WireShaped,
} from "../handlers/wire-error";
import { type AppServices, getRuntime } from "../runtime";

export class RpcError extends Data.TaggedError("RpcError")<{
  readonly code: Code;
  readonly message: string;
}> {}

export type RpcEffect<A> = Effect.Effect<A, RouteError | RpcError, AppServices>;

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

const _rpcFailuresAreParsed: [Exclude<RouteError | RpcError, BoundaryError>] extends [
  RpcError | WireShaped,
]
  ? true
  : never = true;

const parseConnectWire = (e: unknown): RpcError | WireShaped | undefined =>
  e instanceof RpcError ? e : parseWireShaped(e);

function causeToConnectError(cause: Cause.Cause<RouteError | RpcError>): ConnectError {
  const { failure, reported } = settleCause(cause, parseConnectWire, {
    label: "[runRpc]",
    tags: { handler: "runRpc" },
  });
  if (failure instanceof RpcError) return new ConnectError(failure.message, failure.code);
  if (failure) return new ConnectError(failure.error, statusToCode(failure.status));
  // consumer は message を表示に使うため Code.Unknown + 元 message を保ち "internal error" に潰さない。
  return ConnectError.from(reported[0]);
}
