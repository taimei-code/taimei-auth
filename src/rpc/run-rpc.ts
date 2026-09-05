import { Code, ConnectError } from "@connectrpc/connect";
import type { Cause, Effect } from "effect";
import { Data, Exit } from "effect";
import {
  classifyCause,
  type InternalReport,
  isWireShaped,
  type RouteError,
  type WireError,
} from "../handlers/wire-error";
import { type AppServices, getRuntime } from "../runtime";
import { Sentry } from "../sentry";

// ConnectRPC 側の Transport adapter (ADR-0017 Decision の境界表 2 行目と Sentry 項)。runRoute と同じ catalog を Connect の Code に写像する
// 唯一の点。rpc handler 固有の (message 付き) 失敗は RpcError で運び、message と Code をそのまま保つ。
//   RpcError                    → ConnectError(message, code)
//   guard / domain failure → ConnectError(error code, statusToCode(status))
//   boundary error              → Sentry(cause) → ConnectError.from(cause) (Code.Unknown + 元 message、旧契約)
//   defect / interrupt          → Sentry(原 Error / Cause.pretty) → ConnectError.from(原 Error)

// code は Connect の Code enum に限る (旧 `new ConnectError(msg, Code.X)` が持っていた enum 制約を保つ)。
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

// Connect の wire 語彙は HTTP 側より 1 つ広い: RpcError は自前の message + Code を持つ。
const canSerializeToConnect = (e: unknown): boolean => e instanceof RpcError || isWireShaped(e);

function causeToConnectError(cause: Cause.Cause<RouteError | RpcError>): ConnectError {
  const { failure, reports } = classifyCause<WireError | RpcError>(cause, canSerializeToConnect);
  for (const report of reports) reportInternalFailure(report);
  if (failure instanceof RpcError) return new ConnectError(failure.message, failure.code);
  if (failure) return new ConnectError(failure.error, statusToCode(failure.status));
  // 旧経路 (handler の throw を ConnectRPC adapter が Code.Unknown + 元 message に写像) と同じ契約を保つ。
  // consumer (packages/auth-client) は message を表示に使うため、"internal error" に潰さない。
  return ConnectError.from(reports[0]?.error);
}

// Sentry に加えて console にも出す (runRoute と同じ理由: Sentry が落ちている時の観測手段)。
function reportInternalFailure(report: InternalReport): void {
  console.error("[runRpc]", report.error);
  Sentry.captureException(report.error, {
    level: report.boundary ? "warning" : "error",
    tags: { handler: "runRpc" },
  });
}
