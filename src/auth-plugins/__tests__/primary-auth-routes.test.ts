import { describe, expect, test } from "bun:test";
import {
  parsePrimaryAuthRoute,
  PRIMARY_AUTH_ROUTES,
  type PrimaryAuthRoute,
} from "../primary-auth-routes";

describe("parsePrimaryAuthRoute", () => {
  const table: [string, Record<string, unknown> | undefined, PrimaryAuthRoute][] = [
    [
      "/callback/:id",
      { id: 1 },
      { _tag: "Unmapped", path: "/callback/:id", providerId: undefined },
    ],
    ["/magic-link/verify", undefined, { _tag: "Mapped", method: "magic_link" }],
    ["/magic-link/verify", { id: "github" }, { _tag: "Mapped", method: "magic_link" }],
    ["/callback/:id", { id: "github" }, { _tag: "Mapped", method: "github" }],
    [
      "/callback/:id",
      { id: "gitlab" },
      { _tag: "Unmapped", path: "/callback/:id", providerId: "gitlab" },
    ],
    [
      "/callback/:id",
      undefined,
      { _tag: "Unmapped", path: "/callback/:id", providerId: undefined },
    ],
    ["/sign-out", undefined, { _tag: "Unmapped", path: "/sign-out", providerId: undefined }],
  ];
  for (const [path, params, expected] of table) {
    test(`${path} id=${String(params?.id)} → ${expected._tag}`, () => {
      expect(parsePrimaryAuthRoute(path, params)).toEqual(expected);
    });
  }

  test("matcher が通す PRIMARY_AUTH_ROUTES は全て github で Mapped になる (allowlist と parser のずれを止める)", () => {
    for (const route of PRIMARY_AUTH_ROUTES) {
      expect(parsePrimaryAuthRoute(route, { id: "github" })._tag).toBe("Mapped");
    }
  });
});
