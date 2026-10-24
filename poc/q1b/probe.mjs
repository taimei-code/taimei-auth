import { chromium } from "playwright";

const candidates = {
  "1D-a hostname": "MAP auth.taimei-code.localhost auth-host, MAP app.taimei-code.localhost app-host",
  "1D-b ip": "MAP auth.taimei-code.localhost 172.30.0.10, MAP app.taimei-code.localhost 172.30.0.11",
};

const run = async (rules) => {
  const browser = await chromium.launch({ args: [`--host-resolver-rules=${rules}`] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const text = async (url) =>
    page.goto(url).then(
      async () => (await page.textContent("body"))?.trim(),
      (error) => String(error).split("\n")[0],
    );
  const result = {};
  result.setOnAuth = await text("http://auth.taimei-code.localhost:3100/set");
  result.isSecureContextOnAuth = await page.evaluate(() => window.isSecureContext).catch(String);
  result.storedCookies = (await context.cookies()).map((c) => `${c.name} domain=${c.domain} secure=${c.secure}`);
  result.sentToAuth = await text("http://auth.taimei-code.localhost:3100/echo");
  result.sentToApp = await text("http://app.taimei-code.localhost:3001/echo");
  result.isSecureContextOnApp = await page.evaluate(() => window.isSecureContext).catch(String);
  await browser.close();
  return result;
};

for (const [name, rules] of Object.entries(candidates)) {
  console.log(JSON.stringify({ candidate: name, rules, ...(await run(rules)) }, null, 2));
}
