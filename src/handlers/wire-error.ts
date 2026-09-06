import { Cause } from "effect";
import { type BoundaryError, isBoundaryError } from "../errors";
import { type CaptureContext, Sentry } from "../sentry";
import type { CompanyError } from "../company/errors";
import type { InvitationError } from "../invitation/errors";
import type { MembershipError } from "../membership/errors";
import type { GuardError } from "../membership/guard/errors";
import type { MfaError } from "../mfa/error-mapping";
import type { MfaWireErrorCode } from "../mfa/wire-contracts";

// Transport の wire 直列化 (ADR-0017 Decision の境界表 2 行目)。旧 membership/guard/respond.ts の error response 生成を
// 引き継ぎ、明示 header で charset 無しの application/json を付けて成功 response と byte-invariant を保つ。
// Web 標準 Response だけを組み、hono には依存しない。末尾の reportInternalFailures と captureThrown だけは Sentry への
// 報告口で副作用 (console.error + Sentry) を持つ。

// domain failure (use-case が返す) も wire code / status を自身で持つ (各 domain の errors.ts)。
export type DomainError = MembershipError | CompanyError | InvitationError;

// MFA の failure class (src/mfa/error-mapping.ts) も同じ形 ({ error, status }) で E channel に載る。
export type WireError = GuardError | DomainError | MfaError;

// 型で固定する不変条件 (ADR-0017 Decision の failure 項、catalog 分散の整合): MFA route に到達する guard 由来の code (requireActor の unauthorized / parseZodBody の
// invalid_argument) が GuardError の class と MFA の wire 語彙 (MfaWireErrorCode) の両方に存在する
// (どちらかから落ちると typecheck が落ちる)。MFA 自身の code は mfa/error-mapping.ts の検出器が縛る。
type GuardCodesOnMfaRoutes = "unauthorized" | "invalid_argument";
const _guardCodesReachMfaWire: [GuardCodesOnMfaRoutes] extends [GuardError["error"]]
  ? [GuardCodesOnMfaRoutes] extends [MfaWireErrorCode]
    ? true
    : never
  : never = true;

// runRoute / runRpc が受ける failure の全体。boundary error は wire に出さず 500 + Sentry に写像する。
export type RouteError = WireError | BoundaryError;

// 成功 response (c.json) と同じ charset 無しの content-type。
export const JSON_HEADERS = { "content-type": "application/json" } as const;

export function wireErrorResponse(failure: WireError): Response {
  const body: { error: string; details?: unknown } = { error: failure.error };
  // details を持つ failure (InvalidArgument) だけ載せ、undefined のときは key 自体を出さない (byte-invariant)。
  if ("details" in failure && failure.details !== undefined) body.details = failure.details;
  return new Response(JSON.stringify(body), { status: failure.status, headers: JSON_HEADERS });
}

// Hono 既定の errorHandler (`c.text("Internal Server Error", 500)`) と同じ body / status / content-type。
// 旧経路と byte-invariant。
const TEXT_HEADERS = { "content-type": "text/plain; charset=UTF-8" } as const;

export function internalErrorResponse(): Response {
  return new Response("Internal Server Error", { status: 500, headers: TEXT_HEADERS });
}

// wire に出せる failure の実行時の形。型 (RouteError union) だけに頼ると、catalog 外の failure class が E に
// 紛れたとき `status: undefined` → 200 / body `{}` の fail-open になるため、adapter は実行時にも形を見る。
export const isWireShaped = (e: unknown): e is { error: string; status: number } =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as { error?: unknown }).error === "string" &&
  typeof (e as { status?: unknown }).status === "number";

// adapter 共通の Cause 分類。reasons をすべて走査し、wire に出せる failure (最初の 1 件) と、Sentry に送る内部失敗
// (boundary error の cause / defect / 形の合わない failure / interrupt) を分けて返す。並行合成や finalizer で
// reasons が複数になっても defect を取りこぼさない。応答は failure があればそれ、無ければ 500。
// boundary = サードパーティ境界の障害 (Redis / DB / better-auth)。adapter は Sentry level を warning に落とし、
// バグ (defect / 形の合わない failure) と区別する。未認証 route の障害連打で error quota を食わないための方針。
export type InternalReport = { error: unknown; boundary: boolean };
export type ClassifiedCause<E> = { failure: E | undefined; reports: InternalReport[] };

// canSerializeToWire を差し替えられるのは runRpc のため: Connect 側は RpcError (message + Code) も
// そのまま wire に出せる語彙に含む。
export function classifyCause<E>(
  cause: Cause.Cause<E | BoundaryError>,
  canSerializeToWire: (e: unknown) => boolean = isWireShaped,
): ClassifiedCause<E> {
  let failure: E | undefined;
  const reports: InternalReport[] = [];
  for (const reason of cause.reasons) {
    if (reason._tag === "Fail") {
      if (isBoundaryError(reason.error))
        reports.push({ error: reason.error.cause, boundary: true });
      else if (canSerializeToWire(reason.error)) failure ??= reason.error as E;
      else reports.push({ error: reason.error, boundary: false });
    } else if (reason._tag === "Die") {
      reports.push({ error: reason.defect, boundary: false });
    }
  }
  if (failure === undefined && reports.length === 0) {
    reports.push({ error: new Error(Cause.pretty(cause)), boundary: false });
  }
  return { failure, reports };
}

// adapter と captureThrown が共有する報告口。Sentry に加えて console にも出す (Hono 既定の errorHandler が
// console.error していた観測手段を Sentry が落ちている時のために残す)。境界障害は warning (バグと区別)。
export function reportInternalFailures(
  reports: InternalReport[],
  label: string,
  context: Pick<CaptureContext, "tags" | "extra">,
): void {
  for (const report of reports) {
    console.error(label, report.error);
    Sentry.captureException(report.error, {
      ...context,
      level: report.boundary ? "warning" : "error",
    });
  }
}

// Effect の外 (better-auth の onAPIError.onError / src/app.ts の auth.handler 呼び出し) で受けた thrown value を
// adapter と同じ規則で Sentry に送る。wire は無いので canSerializeToWire を常に false にし、boundary error は cause を
// warning、それ以外は error にする。観測自体の失敗 (Sentry backend の throw) は握る: better-call は onError の throw を
// auth.handler の reject にし、better-auth が組んだ 500 応答 (Set-Cookie 合流) を失わせる (mfa-challenge.ts の report と
// 同じ規則)。元の error は reportInternalFailures が Sentry より先に console.error するので痕跡は残る。
export function captureThrown(error: unknown, component: string): void {
  try {
    reportInternalFailures(
      classifyCause(Cause.fail(error), () => false).reports,
      `[${component}]`,
      {
        tags: { component },
      },
    );
  } catch (reportError) {
    console.error(`[${component}] failed to report to Sentry`, reportError);
  }
}
