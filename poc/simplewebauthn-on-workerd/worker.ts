import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP_ID = "localhost";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>poc: simplewebauthn on workerd</title>
<script>
const post = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

window.register = async (userVerification, requireUserVerification, residentKey, supportedAlgorithmIDs) => {
  const options = await post("/register/options", {
    userVerification,
    residentKey,
    supportedAlgorithmIDs,
  });
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  return post("/register/verify", {
    response: credential.toJSON(),
    expectedChallenge: options.challenge,
    requireUserVerification,
  });
};

window.login = async (userVerification, stored, allowCredentials, expectedChallenge) => {
  const options = await post("/login/options", { userVerification, allowCredentials });
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  const sent = {
    response: credential.toJSON(),
    expectedChallenge: expectedChallenge ?? options.challenge,
    credential: stored,
  };
  return { ...(await post("/login/verify", sent)), sent };
};
</script>`;

type Body = {
  userVerification?: "required" | "preferred";
  requireUserVerification?: boolean;
  residentKey?: "required" | "discouraged";
  allowCredentials?: { id: string }[];
  supportedAlgorithmIDs?: number[];
  response?: never;
  expectedChallenge?: string;
  credential?: { id: string; publicKey: string; counter: number };
};

const route = async (pathname: string, origin: string, body: Body): Promise<unknown> => {
  if (pathname === "/register/options")
    return generateRegistrationOptions({
      rpName: "poc",
      rpID: RP_ID,
      userName: "poc@example.com",
      attestationType: "none",
      supportedAlgorithmIDs: body.supportedAlgorithmIDs,
      authenticatorSelection: {
        residentKey: body.residentKey ?? "required",
        userVerification: body.userVerification,
      },
    });

  if (pathname === "/register/verify") {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: body.expectedChallenge as string,
      expectedOrigin: origin,
      expectedRPID: RP_ID,
      requireUserVerification: body.requireUserVerification ?? true,
    });
    if (!verified) return { verified };
    return {
      verified,
      userVerified: registrationInfo.userVerified,
      fmt: registrationInfo.fmt,
      credentialDeviceType: registrationInfo.credentialDeviceType,
      credential: {
        id: registrationInfo.credential.id,
        publicKey: isoBase64URL.fromBuffer(registrationInfo.credential.publicKey),
        counter: registrationInfo.credential.counter,
      },
    };
  }

  if (pathname === "/login/options")
    return generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: body.userVerification,
      allowCredentials: body.allowCredentials ?? [],
    });

  if (pathname === "/login/verify") {
    const stored = body.credential as NonNullable<Body["credential"]>;
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: body.expectedChallenge as string,
      expectedOrigin: origin,
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
      },
      requireUserVerification: true,
    });
    return {
      verified,
      userVerified: authenticationInfo.userVerified,
      newCounter: authenticationInfo.newCounter,
    };
  }

  return { error: "not found" };
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET")
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    try {
      return Response.json(await route(url.pathname, url.origin, await request.json()));
    } catch (error) {
      return Response.json({ verified: false, error: String(error) });
    }
  },
};
