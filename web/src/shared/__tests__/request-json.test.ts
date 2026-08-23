import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { RequestJsonError, describeRequestJsonError, getJson, postJson } from "../request-json";
import { restoreFetch, stubFetch } from "./fetch-stub";

afterEach(restoreFetch);

describe("getJson", () => {
  test("credentials 付き GET の JSON を返す", async () => {
    const fetchSpy = stubFetch(Response.json({ value: 1 }));

    expect(await getJson<{ value: number }>("/example")).toEqual({ value: 1 });
    expect(fetchSpy).toHaveBeenCalledWith("/example", { credentials: "include" });
  });

  test("成功時の空 body は reject する", async () => {
    stubFetch(new Response(null, { status: 200 }));

    await expect(getJson("/empty")).rejects.toBeInstanceOf(SyntaxError);
  });

  test("成功時の不正 JSON は parse error を返す", async () => {
    stubFetch(new Response("not-json", { status: 200 }));

    await expect(getJson("/invalid")).rejects.toBeInstanceOf(SyntaxError);
  });

  test("非 2xx は status を持つ RequestJsonError を返す", async () => {
    stubFetch(new Response("ignored", { status: 503 }));

    await expect(getJson("/unavailable")).rejects.toEqual(
      new RequestJsonError(503, "GET /unavailable failed: 503"),
    );
  });
});

describe("postJson", () => {
  test("body ありは JSON header と文字列化 body を送る", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    expect(await postJson<{ ok: true }>("/example", { value: 1 })).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith("/example", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
  });

  test("body なしも JSON header を保ち body は undefined にする", async () => {
    const fetchSpy = stubFetch(new Response(null, { status: 204 }));

    expect(await postJson("/empty")).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith("/empty", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
  });

  test("成功時の不正 JSON は parse error を返す", async () => {
    stubFetch(new Response("not-json", { status: 200 }));

    await expect(postJson("/invalid")).rejects.toBeInstanceOf(SyntaxError);
  });

  test("非 2xx の response text を error message に保つ", async () => {
    stubFetch(new Response("forbidden", { status: 403 }));

    await expect(postJson("/forbidden")).rejects.toEqual(new RequestJsonError(403, "forbidden"));
  });

  test("非 2xx の空 body は method と URL の message に倒す", async () => {
    stubFetch(new Response(null, { status: 500 }));

    await expect(postJson("/failed")).rejects.toEqual(
      new RequestJsonError(500, "POST /failed failed: 500"),
    );
  });

  test("response text 読取失敗も method と URL の message に倒す", async () => {
    const response = new Response(null, { status: 500 });
    spyOn(response, "text").mockRejectedValue(new TypeError("unreadable"));
    stubFetch(response);

    await expect(postJson("/unreadable")).rejects.toEqual(
      new RequestJsonError(500, "POST /unreadable failed: 500"),
    );
  });
});

describe("describeRequestJsonError", () => {
  const messages = { 403: "権限がありません。", fallback: "失敗しました。" } as const;

  test("一致する status の文言を返す", () => {
    expect(describeRequestJsonError(new RequestJsonError(403, "raw"), messages)).toBe(
      "権限がありません。",
    );
  });

  test("未知 status と未知 error は fallback を返す", () => {
    expect(describeRequestJsonError(new RequestJsonError(500, "raw"), messages)).toBe(
      "失敗しました。",
    );
    expect(describeRequestJsonError(new TypeError("network"), messages)).toBe("失敗しました。");
  });
});
