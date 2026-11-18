import { afterEach, describe, expect, test } from "bun:test";
import {
  createUser,
  forgetScenario,
  openSession,
  readListedIds,
  sendDeletion,
  storePasskey,
} from "./harness/passkey-delete-api";

describe("パスキーの削除の API が触れないもの", () => {
  afterEach(forgetScenario);

  test("user が自分のパスキーの削除を送っても、ほかの user のパスキーは一覧に残る", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner);
    const others = [await storePasskey(other), await storePasskey(other)].toSorted();

    await sendDeletion(openSession(owner), own);

    expect((await readListedIds(openSession(other))).toSorted()).toEqual(others);
  });
});
