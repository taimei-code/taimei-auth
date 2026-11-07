import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { UrlRequest } from "foldkit/navigation";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString, type Url } from "foldkit/url";

import { init, LoadDocument, Message, type Model, PushUrl, update } from "../auth/main";
import type { ErrorPageReason } from "../../auth/auth-error-reason";
import { AuthRoute } from "../auth/route";

const urlOf = (href: string): Url =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const modelAt = (href: string): Model => init(urlOf(href)).model;

describe("エラー画面の application は URL の理由を route に読む", () => {
  test.each<[string, Option.Option<ErrorPageReason>]>([
    ["signin_failed", Option.some("signin_failed")],
    ["invalid_redirect_url", Option.some("invalid_redirect_url")],
    ["bogus", Option.none()],
  ])("reason=%s を開くと、その理由の route になる", (reason, maybeReason) => {
    expect(modelAt(`https://auth.example.com/auth/error?reason=${reason}`).route).toEqual(
      AuthRoute.Error({ reason: maybeReason }),
    );
  });

  test("末尾に / の付いたエラー画面も、同じ理由の route になる", () => {
    expect(modelAt("https://auth.example.com/auth/error/?reason=signin_failed").route).toEqual(
      AuthRoute.Error({ reason: Option.some("signin_failed") }),
    );
  });

  test("理由の無いエラー画面は、理由なしの route になる", () => {
    expect(modelAt("https://auth.example.com/auth/error").route).toEqual(
      AuthRoute.Error({ reason: Option.none() }),
    );
  });

  test("URL が変わると、新しい URL の route に替わる", () => {
    story(
      update,
      given(modelAt("https://auth.example.com/auth/error")),
      message(
        Message.ChangedUrl({
          url: urlOf("https://auth.example.com/auth/error?reason=signin_failed"),
        }),
      ),
      model((next) => {
        expect(next.route).toEqual(AuthRoute.Error({ reason: Option.some("signin_failed") }));
      }),
    );
  });
});

describe("エラー画面の application の link", () => {
  test("同じ application の route への link は、document を読み直さずに URL を替える", () => {
    story(
      update,
      given(modelAt("https://auth.example.com/auth/error")),
      message(
        Message.ClickedLink({
          request: UrlRequest.Internal({
            url: urlOf("https://auth.example.com/auth/error?reason=signin_failed"),
          }),
        }),
      ),
      Command.expectExact(PushUrl),
      Command.resolve(PushUrl, Message.CompletedPushUrl()),
    );
  });

  test("別の application の path への link は、document を読み直す", () => {
    story(
      update,
      given(modelAt("https://auth.example.com/auth/error")),
      message(
        Message.ClickedLink({
          request: UrlRequest.Internal({ url: urlOf("https://auth.example.com/account") }),
        }),
      ),
      Command.expectExact(LoadDocument),
      Command.resolve(LoadDocument, Message.CompletedLoadDocument()),
    );
  });

  test("外の site への link は、document を読み直す", () => {
    story(
      update,
      given(modelAt("https://auth.example.com/auth/error")),
      message(
        Message.ClickedLink({ request: UrlRequest.External({ href: "https://example.com/" }) }),
      ),
      Command.expectExact(LoadDocument),
      Command.resolve(LoadDocument, Message.CompletedLoadDocument()),
    );
  });
});
