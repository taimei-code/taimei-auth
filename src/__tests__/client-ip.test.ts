import { describe, expect, test } from "bun:test";
import { CLIENT_IP_HEADER, withClientIp } from "../client-ip";

const post = (headers: Record<string, string>) =>
  new Request("https://auth.example/api/auth/sign-in/magic-link", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "a@example.com" }),
  });

describe("入口が決めた client の IP を request に置く", () => {
  test("client が送った同じ名前の header は、入口が決めた IP で上書きする", () => {
    const request = withClientIp(post({ [CLIENT_IP_HEADER]: "198.51.100.1" }), "203.0.113.9");
    expect(request.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.9");
  });

  test("入口が IP を決められない時は header を置かず、client が送った値も消す", () => {
    const request = withClientIp(post({ [CLIENT_IP_HEADER]: "198.51.100.1" }), null);
    expect(request.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });

  test("method・URL・body・他の header は変えない", async () => {
    const original = post({ "content-type": "application/json" });
    const request = withClientIp(post({ "content-type": "application/json" }), "203.0.113.9");

    expect(request.method).toBe("POST");
    expect(request.url).toBe(original.url);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.text()).toBe(await original.text());
  });
});
