import { expect, test } from "bun:test";
import type { SpaApi } from "../../spa-contract";
import type { EndpointsBreakingReauthentication } from "../reauthentication-contract";

type SpaGroup = (typeof SpaApi)["groups"][keyof (typeof SpaApi)["groups"]];

const _spaDeclaresReauthenticationConsistently: [
  EndpointsBreakingReauthentication<SpaGroup>,
] extends [never]
  ? true
  : false = true;

test("認証手段を足すと表に書いた endpoint に再認証の middleware が無いか、middleware を持つ endpoint が表に無いか、表の名前が SPA の契約に無い endpoint を指すと型エラーになる (typecheck で検査する)", () => {
  expect(_spaDeclaresReauthenticationConsistently).toBe(true);
});
