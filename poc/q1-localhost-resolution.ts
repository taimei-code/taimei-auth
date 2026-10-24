import { chromium } from "@playwright/test";

const LISTEN = 39301;
const UNUSED = 39302;
const server = Bun.serve({ port: LISTEN, hostname: "127.0.0.1", fetch: () => new Response("reached") });

const visit = async (args: string[], url: string) => {
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  const result = await page
    .goto(url)
    .then(async () => (await page.textContent("body"))?.trim(), (error) => String(error).split("\n")[0]);
  await browser.close();
  return result;
};

console.log(
  JSON.stringify({
    noRuleSubdomainOfLocalhost: await visit([], `http://auth.taimei-code.localhost:${LISTEN}/`),
    ruleRemapsPort: await visit(
      [`--host-resolver-rules=MAP auth.taimei-code.localhost 127.0.0.1:${LISTEN}`],
      `http://auth.taimei-code.localhost:${UNUSED}/`,
    ),
  }),
);
server.stop();
