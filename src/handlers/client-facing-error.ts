import { Cause, Predicate } from "effect";
import { type BoundaryError, isBoundaryError } from "../errors";
import { type CaptureContext, Sentry } from "../sentry";
import type { CompanyError } from "../company/errors";
import type { InvitationError } from "../invitation/errors";
import type { MembershipError } from "../membership/errors";
import type { GuardError } from "../membership/guard/errors";
import type { MfaError } from "../mfa/error-mapping";
import type { MfaClientFacingErrorCode } from "../mfa/client-facing-contracts";
import type { ServiceKeyError } from "../service-key";

export type DomainError = MembershipError | CompanyError | InvitationError;

export type ClientFacingError = GuardError | DomainError | MfaError | ServiceKeyError;

export type ClientFacingErrorShape = {
  readonly error: string;
  readonly status: number;
  readonly details?: unknown;
};

type GuardCodesOnMfaRoutes = "unauthorized" | "invalid_argument";
const _guardCodesReachMfaWire: [GuardCodesOnMfaRoutes] extends [GuardError["error"]]
  ? [GuardCodesOnMfaRoutes] extends [MfaClientFacingErrorCode]
    ? true
    : never
  : never = true;

export type RouteError = ClientFacingError | BoundaryError;

const _routeFailuresAreClientFacing: [Exclude<RouteError, BoundaryError>] extends [
  ClientFacingErrorShape,
]
  ? true
  : never = true;

// charset 無しで固定し、Hono の c.json と byte 単位で一致させる。
export const JSON_HEADERS = { "content-type": "application/json" } as const;

export function clientFacingErrorResponse(failure: ClientFacingErrorShape): Response {
  const body = JSON.stringify({ error: failure.error, details: failure.details });
  return new Response(body, { status: failure.status, headers: JSON_HEADERS });
}

const TEXT_HEADERS = { "content-type": "text/plain; charset=UTF-8" } as const;

export function internalErrorResponse(): Response {
  return new Response("Internal Server Error", { status: 500, headers: TEXT_HEADERS });
}

// catalog でなく形で判定し、catalog 漏れの failure を 500 に倒さない。
export const parseClientFacingError = (e: unknown): ClientFacingErrorShape | undefined =>
  Predicate.isObject(e) && Predicate.isString(e.error) && Predicate.isNumber(e.status)
    ? (e as ClientFacingErrorShape)
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
  parseClientFacing: (e: unknown) => W | undefined,
  report: Report,
): { failure: W | undefined; reported: readonly unknown[] } {
  let failure: W | undefined;
  const internal: ReturnType<typeof toInternal>[] = [];
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const clientFacing = isBoundaryError(reason.error)
        ? undefined
        : parseClientFacing(reason.error);
      if (clientFacing === undefined) internal.push(toInternal(reason.error));
      else failure ??= clientFacing;
    } else if (Cause.isDieReason(reason)) internal.push(toInternal(reason.defect));
  }
  if (failure === undefined && internal.length === 0) {
    internal.push(toInternal(new Error(Cause.pretty(cause))));
  }
  for (const r of internal) send(r, report);
  return { failure, reported: internal.map((r) => r.error) };
}

export function captureThrown(error: unknown, component: string): void {
  try {
    send(toInternal(error), { label: `[${component}]`, tags: { component } });
  } catch (reportError) {
    console.error(`[${component}] failed to report to Sentry`, reportError);
  }
}
