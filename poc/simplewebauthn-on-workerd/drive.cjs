const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const [playwrightPath, base] = process.argv.slice(2);
const { chromium } = require(playwrightPath);

const post = (path, body) =>
  fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

const cborHead = (major, n) =>
  n < 24
    ? Buffer.from([(major << 5) | n])
    : n < 256
      ? Buffer.from([(major << 5) | 24, n])
      : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cborInt = (n) => (n >= 0 ? cborHead(0, n) : cborHead(1, -1 - n));
const cborBytes = (bytes) => Buffer.concat([cborHead(2, bytes.length), bytes]);

const coseHead = (registration) =>
  Buffer.from(registration.credential.publicKey, "base64url").subarray(0, 5).toString("hex");

const rs256Login = async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const cosePublicKey = Buffer.concat([
    cborHead(5, 4),
    cborInt(1),
    cborInt(3),
    cborInt(3),
    cborInt(-257),
    cborInt(-1),
    cborBytes(Buffer.from(jwk.n, "base64url")),
    cborInt(-2),
    cborBytes(Buffer.from(jwk.e, "base64url")),
  ]);
  const id = crypto.randomBytes(16).toString("base64url");
  const options = await post("/login/options", { userVerification: "required" });
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: options.challenge,
      origin: new URL(base).origin,
      crossOrigin: false,
    }),
  );
  const authenticatorData = Buffer.concat([
    crypto.createHash("sha256").update("localhost").digest(),
    Buffer.from([0x05]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const signature = crypto.sign(
    "sha256",
    Buffer.concat([authenticatorData, crypto.createHash("sha256").update(clientDataJSON).digest()]),
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
  );
  return post("/login/verify", {
    response: {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    },
    expectedChallenge: options.challenge,
    credential: { id, publicKey: cosePublicKey.toString("base64url"), counter: 0 },
  });
};

const main = async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(base);

  const registration = await page.evaluate(() => window.register("required"));
  const login = await page.evaluate(
    (stored) => window.login("required", stored, [{ id: stored.id }]),
    registration.credential,
  );

  const es256Registration = await page.evaluate(() =>
    window.register("required", true, "required", [-7]),
  );
  const es256Login = await page.evaluate(
    (stored) => window.login("required", stored, [{ id: stored.id }]),
    es256Registration.credential,
  );
  const wrongChallengeLogin = await page.evaluate(
    (stored) => window.login("required", stored, [{ id: stored.id }], "wrong"),
    registration.credential,
  );

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: false,
      hasUserVerification: false,
      automaticPresenceSimulation: true,
    },
  });
  const unverifiedRegistration = await page.evaluate(() => window.register("preferred", true, "discouraged"));
  const laxRegistration = await page.evaluate(() => window.register("preferred", false, "discouraged"));
  const unverifiedLogin = await page.evaluate(
    (stored) => window.login("preferred", stored, [{ id: stored.id }]),
    laxRegistration.credential,
  );

  const rs256 = await rs256Login();
  await browser.close();

  console.log(
    JSON.stringify(
      {
        registration,
        registrationCose: coseHead(registration),
        login,
        es256Registration,
        es256Cose: coseHead(es256Registration),
        es256Login,
        unverifiedRegistration,
        laxRegistration,
        unverifiedLogin,
        wrongChallengeLogin,
        rs256,
      },
      null,
      2,
    ),
  );

  assert.equal(registration.verified, true);
  assert.equal(registration.userVerified, true);
  assert.equal(login.sent.response.id, registration.credential.id);
  assert.equal(es256Login.sent.response.id, es256Registration.credential.id);
  assert.equal(login.verified, true);
  assert.equal(login.userVerified, true);
  assert.equal(coseHead(registration), "a401010327");
  assert.equal(es256Registration.verified, true);
  assert.equal(coseHead(es256Registration), "a501020326");
  assert.equal(es256Login.verified, true);
  assert.equal(es256Login.userVerified, true);
  assert.equal(unverifiedRegistration.verified, false);
  assert.equal(laxRegistration.verified, true);
  assert.equal(laxRegistration.userVerified, false);
  assert.equal(unverifiedLogin.verified, false);
  assert.equal(wrongChallengeLogin.verified, false);
  assert.equal(rs256.verified, true);
  console.log("ALL ASSERTIONS PASSED");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
