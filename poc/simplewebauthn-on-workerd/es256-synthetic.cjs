const crypto = require("node:crypto");
const fs = require("node:fs");

const [base, count, out] = process.argv.slice(2);
const origin = new URL(base).origin;

const derIntegerLengths = (der) => {
  const rLength = der[3];
  const sLength = der[5 + rLength];
  return `${rLength}/${sLength}`;
};

const makeLogin = (privateKey, credential) => {
  const challenge = crypto.randomBytes(32).toString("base64url");
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
  );
  const authenticatorData = Buffer.concat([
    crypto.createHash("sha256").update("localhost").digest(),
    Buffer.from([0x05]),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const signature = crypto.sign(
    "sha256",
    Buffer.concat([authenticatorData, crypto.createHash("sha256").update(clientDataJSON).digest()]),
    { key: privateKey, dsaEncoding: "der" },
  );
  return {
    lengths: derIntegerLengths(signature),
    body: {
      response: {
        id: credential.id,
        rawId: credential.id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      },
      expectedChallenge: challenge,
      credential,
    },
  };
};

const onWorkerd = (body) =>
  fetch(new URL("/login/verify", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

const main = async () => {
  const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
  const onNode = (body) =>
    verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: body.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: "localhost",
      credential: {
        id: body.credential.id,
        publicKey: Buffer.from(body.credential.publicKey, "base64url"),
        counter: 0,
      },
      requireUserVerification: true,
    }).then(
      ({ verified }) => ({ verified }),
      (error) => ({ verified: false, error: String(error) }),
    );

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credential = {
    id: crypto.randomBytes(16).toString("base64url"),
    publicKey: Buffer.concat([
      Buffer.from("a50102032620012158", "hex"),
      Buffer.from([0x20]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from("225820", "hex"),
      Buffer.from(jwk.y, "base64url"),
    ]).toString("base64url"),
    counter: 0,
  };

  const tally = {};
  const failures = [];
  const logins = Array.from({ length: Number(count) }, () => makeLogin(privateKey, credential));
  for (let i = 0; i < logins.length; i += 25) {
    await Promise.all(
      logins.slice(i, i + 25).map(async (login) => {
        const [workerd, node] = await Promise.all([onWorkerd(login.body), onNode(login.body)]);
        const row = (tally[login.lengths] ??= { total: 0, workerdFailed: 0, nodeFailed: 0 });
        row.total += 1;
        if (!workerd.verified) row.workerdFailed += 1;
        if (!node.verified) row.nodeFailed += 1;
        if (!workerd.verified || !node.verified) failures.push({ ...login, workerd, node });
      }),
    );
  }
  fs.writeFileSync(out, JSON.stringify(failures, null, 2));
  console.log(JSON.stringify({ count: logins.length, tally, firstFailure: failures[0] && { lengths: failures[0].lengths, workerd: failures[0].workerd, node: failures[0].node } }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
