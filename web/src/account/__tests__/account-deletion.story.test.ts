import { describe, expect, test } from "bun:test";

import { init, Message, update } from "../account-deletion";

const VISIT = 1;

describe("退会の確認の dialog", () => {
  test("拒まれた後に dialog を開き直すと、前の拒まれた文言を消す", () => {
    const rejected = update(
      update(
        update(init(VISIT), Message.ClickedDeleteAccount()).model,
        Message.ClickedConfirmDeletion(),
      ).model,
      Message.FailedDeleteAccount({ visit: VISIT, failure: "LastOwner" }),
    ).model;
    expect(rejected.deletion._tag).toBe("Rejected");
    expect(update(rejected, Message.ClickedDeleteAccount()).model.deletion._tag).toBe("Idle");
  });
});
