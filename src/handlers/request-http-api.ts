import { Effect } from "effect";
import { Cookies, HttpEffect, type HttpServerRequest, HttpServerResponse } from "effect/http";
import { type BoundaryError, isBoundaryError } from "../errors";

export const headersOf = (request: HttpServerRequest.HttpServerRequest) =>
  new Headers(request.headers as Record<string, string>);

export const dieOnBoundary = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catchIf((e: E): e is Extract<E, BoundaryError> => isBoundaryError(e), Effect.die),
  );

// better-auth が rotate した Set-Cookie を付け忘れると、成功直後にログアウトされる。
export const forwardSetCookies = (forwarded: Headers) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(forwarded.getSetCookie())),
    ),
  );
