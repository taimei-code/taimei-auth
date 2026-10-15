import { Cause, Predicate, Schema } from "effect";
import { type BoundaryError, isBoundaryError } from "../errors";
import type { InvalidArgument, NotFound, RateLimited } from "../membership/guard/errors";
import { type CaptureContext, Sentry } from "../sentry";
import type { ServiceKeyMisconfigured, ServiceKeyRejected } from "../service-key";

export type RouteError =
  | BoundaryError
  | InvalidArgument
  | NotFound
  | RateLimited
  | ServiceKeyRejected
  | ServiceKeyMisconfigured;

export type ClientFacing = {
  readonly failure: object;
  readonly tag: string;
  readonly status: number;
  readonly body: unknown;
};

export const JSON_HEADERS = { "content-type": "application/json" } as const;

export function clientFacingErrorResponse({ status, body }: ClientFacing): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const TEXT_HEADERS = { "content-type": "text/plain; charset=UTF-8" } as const;

export function internalErrorResponse(): Response {
  return new Response("Internal Server Error", { status: 500, headers: TEXT_HEADERS });
}

export const parseClientFacingError = (e: unknown): ClientFacing | undefined => {
  if (!Predicate.isObject(e) || !Predicate.isString(e._tag)) return undefined;
  const schema: unknown = e.constructor;
  if (!Schema.isSchema(schema)) return undefined;
  const status = schema.ast.annotations?.httpApiStatus;
  if (!Predicate.isNumber(status)) return undefined;
  return {
    failure: e,
    tag: e._tag,
    status,
    body: Schema.encodeUnknownSync(schema as Schema.Codec<unknown>)(e),
  };
};

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
