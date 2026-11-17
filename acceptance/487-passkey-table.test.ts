import { afterEach, describe, expect, test } from "bun:test";
import {
  signedRegistration,
  type VerificationOutcome,
  verifyRegistrationResponseOf,
} from "./harness/passkey-registration";
import {
  createUser,
  passkeysOf,
  passkeyToSave,
  removeCreatedUsers,
  removeUser,
  savePasskey,
} from "./harness/passkey-storage";

const KNOWN_TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"];
const CHALLENGE = "Y2hhbGxlbmdlLWZyb20tdGhlLW9wdGlvbnM";
const CLIENT_ERROR = { min: 400, max: 499 };
const acceptAll = () => true;

describe("パスキーの保存と一覧", () => {
  afterEach(removeCreatedUsers);

  test("保存したパスキーが、その user の一覧に、保存した値と登録日時を持ち、最後に使った日時の無いパスキーとして 1 つ出る", async () => {
    const owner = await createUser("owner");
    const passkey = passkeyToSave();

    expect(await savePasskey(owner, passkey)).toBe(true);

    const listed = await passkeysOf(owner);
    expect(listed).toHaveLength(1);
    const [only] = listed;
    expect(only?.credentialId).toBe(passkey.credentialId);
    expect(only?.publicKey).toEqual(passkey.publicKey);
    expect(only?.counter).toBe(passkey.counter);
    expect(only?.aaguid).toBe(passkey.aaguid);
    expect(only?.transports).toEqual(passkey.transports);
    expect(only?.registeredAt).toBeInstanceOf(Date);
    expect(only?.lastUsedAt).toBeNull();
  });

  test("user の一覧には、ほかの user が保存したパスキーが出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = passkeyToSave();
    await savePasskey(owner, own);
    await savePasskey(other, passkeyToSave());

    expect((await passkeysOf(owner)).map(({ credentialId }) => credentialId)).toEqual([
      own.credentialId,
    ]);
  });

  test("同じ credential の id のパスキーを同時に 2 回保存すると、片方だけが保存されたと返り、一覧には 1 つだけ出る", async () => {
    const owner = await createUser("owner");
    const passkey = passkeyToSave();

    const results = await Promise.all([savePasskey(owner, passkey), savePasskey(owner, passkey)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await passkeysOf(owner)).map(({ credentialId }) => credentialId)).toEqual([
      passkey.credentialId,
    ]);
  });

  test("ほかの user が保存済みの credential の id を保存すると、保存されなかったと返り、一覧に出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const passkey = passkeyToSave();
    await savePasskey(owner, passkey);

    expect(await savePasskey(other, passkey)).toBe(false);
    expect(await passkeysOf(other)).toEqual([]);
  });

  test("user を消すと、その user の一覧からパスキーが消え、同じ credential の id を別の user で保存できる", async () => {
    const owner = await createUser("owner");
    const next = await createUser("next");
    const passkey = passkeyToSave();
    await savePasskey(owner, passkey);

    await removeUser(owner);

    expect(await passkeysOf(owner)).toEqual([]);
    expect(await savePasskey(next, passkey)).toBe(true);
  });
});

describe("検証の入口が保存の前に絞る値", () => {
  test("応答の transports に未知の文字列や文字列でない要素が混じっていても、結果の transports は既知の値だけを持ち、含まれた既知の値は失わない", async () => {
    const outcome: VerificationOutcome = await verifyRegistrationResponseOf(
      signedRegistration({
        algorithm: "ES256",
        challenge: CHALLENGE,
        userVerified: true,
        transports: ["usb", "x".repeat(10_000), 42, null, { usb: true }, "usb", "hybrid"],
      }).response,
      acceptAll,
    );

    expect(outcome).toHaveProperty("accepted");
    const transports = "accepted" in outcome ? (outcome.accepted.transports ?? []) : [];
    expect(transports.every((transport) => KNOWN_TRANSPORTS.includes(transport))).toBe(true);
    expect(new Set(transports)).toEqual(new Set(["usb", "hybrid"]));
  });

  test("credential の id が 1,024 byte の応答は、4xx の既知の失敗になる", async () => {
    const outcome = await verifyRegistrationResponseOf(
      signedRegistration({
        algorithm: "ES256",
        challenge: CHALLENGE,
        userVerified: true,
        credentialIdBytes: 1024,
      }).response,
      acceptAll,
    );

    expect(outcome).toHaveProperty("rejected");
    const status = "rejected" in outcome ? outcome.rejected.status : 0;
    expect(status).toBeGreaterThanOrEqual(CLIENT_ERROR.min);
    expect(status).toBeLessThanOrEqual(CLIENT_ERROR.max);
  });
});
