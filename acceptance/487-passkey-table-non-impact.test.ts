import { expect, test } from "bun:test";
import { signedRegistration, verifyRegistrationResponseOf } from "./harness/passkey-registration";

test("credential の id が 1,023 byte の応答は検証を通り、その credential の id が得られる", async () => {
  const { response, made } = signedRegistration({
    algorithm: "ES256",
    challenge: "Y2hhbGxlbmdlLWZyb20tdGhlLW9wdGlvbnM",
    userVerified: true,
    credentialIdBytes: 1023,
  });

  const outcome = await verifyRegistrationResponseOf(response, () => true);

  expect(outcome).toHaveProperty("accepted");
  expect("accepted" in outcome ? outcome.accepted.id : "").toBe(made.id);
});
