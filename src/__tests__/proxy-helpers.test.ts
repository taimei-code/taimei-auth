import { test, expect, describe } from "bun:test";
import { buildProxyHeaders } from "../proxy-helpers";

describe("buildProxyHeaders", () => {
  test("transfer-encoding を削除し content-length を設定する", () => {
    const src = new Headers({
      "transfer-encoding": "chunked",
      "content-type": "application/proto",
      "x-service-key": "abc",
    });

    const out = buildProxyHeaders(src, 79);

    expect(out.get("transfer-encoding")).toBe(null);
    expect(out.get("content-length")).toBe("79");
    expect(out.get("content-type")).toBe("application/proto");
    expect(out.get("x-service-key")).toBe("abc");
  });

  test("contentLength が undefined なら content-length を設定しない（GET 等）", () => {
    const src = new Headers({ "content-type": "application/proto" });
    const out = buildProxyHeaders(src);

    expect(out.get("content-length")).toBe(null);
  });

  test("元 Headers を変更しない（不変性）", () => {
    const src = new Headers({ "transfer-encoding": "chunked" });
    buildProxyHeaders(src, 10);

    expect(src.get("transfer-encoding")).toBe("chunked");
  });

  test("contentLength=0 でも content-length: 0 を設定する", () => {
    const src = new Headers();
    const out = buildProxyHeaders(src, 0);

    expect(out.get("content-length")).toBe("0");
  });
});
