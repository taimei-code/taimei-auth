import { expect, test } from "bun:test";

import { AVATAR_UPLOAD_TOKEN_PATH } from "../account-atom";

test("avatar の upload の token を取る path は契約の endpoint の path", () => {
  expect(AVATAR_UPLOAD_TOKEN_PATH).toBe("/api/account/avatar/upload-token");
});
