import { test } from "bun:test";
import { buildApp } from "../../src/app";

test("probe", async () => {
  const label = `variant=${process.env.POC_VARIANT} APP_ENV=${process.env.APP_ENV ?? "(unset)"} AUTH_TESTING_API=${process.env.AUTH_TESTING_API ?? "(unset)"} AUTH_TESTING_KEY=${process.env.AUTH_TESTING_KEY ? "set" : "(unset)"} header=${process.env.POC_SEND_KEY ?? "(none)"}`;
  let app: ReturnType<typeof buildApp>;
  try {
    app = buildApp({ mountStatic: () => {} });
  } catch (error) {
    console.log(`RESULT ${label} => buildApp threw: ${(error as Error).message}`);
    return;
  }
  const response = await app.request("/testing/v1/signed-in-users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.POC_SEND_KEY ? { "X-Testing-Key": process.env.POC_SEND_KEY } : {}),
    },
    body: JSON.stringify({ companies: [{ role: "OWNER" }], returnTo: "http://localhost:3000/after" }),
  });
  console.log(`RESULT ${label} => status=${response.status}`);
});
