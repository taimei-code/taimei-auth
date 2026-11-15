const fs = require("node:fs");

const [playwrightPath, base, count, out] = process.argv.slice(2);
const { chromium } = require(playwrightPath);

const main = async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
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
  const registration = await page.evaluate(() =>
    window.register("required", true, "required", [-7]),
  );
  const failures = [];
  const passes = [];
  for (let i = 0; i < Number(count); i++) {
    const login = await page.evaluate(
      (stored) => window.login("required", stored),
      registration.credential,
    );
    (login.verified ? passes : failures).push(login);
  }
  await browser.close();
  fs.writeFileSync(out, JSON.stringify({ failures, passes: passes.slice(0, 3) }, null, 2));
  const errors = {};
  for (const failure of failures) errors[failure.error] = (errors[failure.error] ?? 0) + 1;
  console.log(JSON.stringify({ count: Number(count), failed: failures.length, errors }));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
