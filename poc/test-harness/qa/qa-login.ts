import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createTestingClient } from "@taimei-code/auth-client/testing";

const testing = createTestingClient("http://localhost:3110");
const signedIn = await testing.createSignedInUser({
  companies: [{ role: "OWNER" }],
  returnTo: "http://localhost:3000/auth/after-signin",
});
const page = join(import.meta.dir, "..", "out", "qa-login.html");
writeFileSync(page, `<meta http-equiv="refresh" content="0;url=${signedIn.loginUrl}">`);
console.log(`OBSERVE login page file://${page}`);

const browser = await chromium.launch();
const context = await browser.newContext();
const tab = await context.newPage();
const responses: string[] = [];
tab.on("response", (r) => responses.push(`${r.status()} ${new URL(r.url()).origin}${new URL(r.url()).pathname}`));
await tab.goto(`file://${page}`).catch(() => {});
await tab.waitForURL((url) => url.origin === "http://localhost:3000", { timeout: 10000 }).catch(() => {});
console.log(`OBSERVE responses=${JSON.stringify(responses)}`);
const cookies = await context.cookies("http://localhost:3110");
console.log(`OBSERVE auth-cookie-names=${JSON.stringify(cookies.map((c) => c.name))}`);
await browser.close();
