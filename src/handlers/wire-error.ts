import { Cause, Predicate } from "effect";
import { type BoundaryError, isBoundaryError } from "../errors";
import { type CaptureContext, Sentry } from "../sentry";
import type { CompanyError } from "../company/errors";
import type { InvitationError } from "../invitation/errors";
import type { MembershipError } from "../membership/errors";
import type { GuardError } from "../membership/guard/errors";
import type { MfaError } from "../mfa/error-mapping";
import type { MfaWireErrorCode } from "../mfa/wire-contracts";

export type DomainError = MembershipError | CompanyError | InvitationError;

export type WireError = GuardError | DomainError | MfaError;

export type WireShaped = {
  readonly error: string;
  readonly status: number;
  readonly details?: unknown;
};

type GuardCodesOnMfaRoutes = "unauthorized" | "invalid_argument";
const _guardCodesReachMfaWire: [GuardCodesOnMfaRoutes] extends [GuardError["error"]]
  ? [GuardCodesOnMfaRoutes] extends [MfaWireErrorCode]
    ? true
    : never
  : never = true;

export type RouteError = WireError | BoundaryError;

const _routeFailuresAreWireShaped: [Exclude<RouteError, BoundaryError>] extends [WireShaped]
  ? true
  : never = true;

// charset 無しの application/json を明示する (byte-invariant の理由: ADR-0012「error Response builder は Hono 非依存」)
export const JSON_HEADERS = { "content-type": "application/json" } as const;

export function wireErrorResponse(failure: WireShaped): Response {
  const body = JSON.stringify({ error: failure.error, details: failure.details });
  return new Response(body, { status: failure.status, headers: JSON_HEADERS });
}

const TEXT_HEADERS = { "content-type": "text/plain; charset=UTF-8" } as const;

export function internalErrorResponse(): Response {
  return new Response("Internal Server Error", { status: 500, headers: TEXT_HEADERS });
}

// catalog 外の failure を実行時にも形で見る (fail-open を防ぐ理由: ADR-0017「実装の機構」)
export const parseWireShaped = (e: unknown): WireShaped | undefined =>
  Predicate.isObject(e) && Predicate.isString(e.error) && Predicate.isNumber(e.status)
    ? (e as WireShaped)
    : undefined;

type Report = Pick<CaptureContext, "tags" | "extra"> & { label: string };

const toInternal = (e: unknown) =>
  isBoundaryError(e)
    ? { error: e.cause, level: "warning" as const }
    : { error: e, level: "error" as const };

const send = ({ error, level }: ReturnType<typeof toInternal>, { label, ...context }: Report) => {
  console.error(label, error);
  Sentry.captureException(error, { ...context, level });
};

export function settleCause<W>(
  cause: Cause.Cause<unknown>,
  parseWire: (e: unknown) => W | undefined,
  report: Report,
): { failure: W | undefined; reported: readonly unknown[] } {
  let failure: W | undefined;
  const internal: ReturnType<typeof toInternal>[] = [];
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const wire = isBoundaryError(reason.error) ? undefined : parseWire(reason.error);
      if (wire === undefined) internal.push(toInternal(reason.error));
      else failure ??= wire;
    } else if (Cause.isDieReason(reason)) internal.push(toInternal(reason.defect));
  }
  if (failure === undefined && internal.length === 0) {
    internal.push(toInternal(new Error(Cause.pretty(cause))));
  }
  for (const r of internal) send(r, report);
  return { failure, reported: internal.map((r) => r.error) };
}

// Effect の外の throw を同じ規則で送る (握る理由: ADR-0017「実装の機構」)
export function captureThrown(error: unknown, component: string): void {
  try {
    send(toInternal(error), { label: `[${component}]`, tags: { component } });
  } catch (reportError) {
    console.error(`[${component}] failed to report to Sentry`, reportError);
  }
}
