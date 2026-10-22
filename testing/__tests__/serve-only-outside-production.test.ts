import { describe, expect, test } from "bun:test";
import {
  OUTSIDE_PRODUCTION_ONLY,
  serveOnlyOutsideProduction,
} from "../serve-only-outside-production";

const servedRequests: string[] = [];

const entry = serveOnlyOutsideProduction<{ APP_ENV?: string }, undefined>({
  fetch: async (req) => {
    servedRequests.push(new URL(req.url).pathname);
    return new Response("served");
  },
});

const fetchWith = (appEnv: string | undefined) => {
  servedRequests.length = 0;
  return entry.fetch(new Request("http://localhost/health"), { APP_ENV: appEnv }, undefined);
};

describe("本番以外の entry は、APP_ENV が development か test の時だけ app に request を渡す", () => {
  test.each([
    ["production", "production"],
    ["誤記", "prodution"],
    ["未設定", undefined],
  ])("APP_ENV が %s なら、app を呼ばずに 500 と拒んだ理由を返す", async (_, appEnv) => {
    const response = await fetchWith(appEnv);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe(OUTSIDE_PRODUCTION_ONLY);
    expect(servedRequests).toEqual([]);
  });

  test.each([
    ["development", "development"],
    ["test", "test"],
  ])("APP_ENV が %s なら、app に渡す", async (_, appEnv) => {
    const response = await fetchWith(appEnv);

    expect(await response.text()).toBe("served");
    expect(servedRequests).toEqual(["/health"]);
  });
});
