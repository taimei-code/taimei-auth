import { Effect } from "effect";
import { Cookies, HttpEffect, type HttpServerRequest, HttpServerResponse } from "effect/http";
import { type BoundaryError, isBoundaryError } from "../errors";

export const headersOf = (request: HttpServerRequest.HttpServerRequest) =>
  new Headers(request.headers);

export const dieOnBoundary = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catchIf((e: E): e is Extract<E, BoundaryError> => isBoundaryError(e), Effect.die),
  );

export const forwardSetCookies = (forwarded: Headers) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(forwarded.getSetCookie())),
    ),
  );
