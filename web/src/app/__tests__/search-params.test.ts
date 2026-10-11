import { expect, test } from "bun:test";

import { parseSearch } from "../search-params";

test("値を JSON や数として解釈せず、文字列のまま返す", () => {
  expect(parseSearch("?invitation_token=123&redirect_url=%5B1%5D")).toEqual({
    invitation_token: "123",
    redirect_url: "[1]",
  });
});
