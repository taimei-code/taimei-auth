import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dir = join(import.meta.dir, "out");
const page = join(dir, "c2-login.html");
writeFileSync(
  page,
  `<script>document.cookie = "better-auth.session_token=poc; domain=localhost; path=/"; document.title = "set:" + document.cookie;</script>`,
);

const browser = await chromium.launch();
const context = await browser.newContext();
const tab = await context.newPage();
await tab.goto(`file://${page}`);
console.log(`OBSERVE title=${await tab.title()}`);
console.log(`OBSERVE cookies-for-localhost=${JSON.stringify(await context.cookies("http://localhost:3110"))}`);
await browser.close();
