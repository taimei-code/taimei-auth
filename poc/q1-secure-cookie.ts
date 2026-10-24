import { chromium } from "@playwright/test";

const PORT = 39100;
const TLS_PORT = 39443;
const LAN_PORT = 39200;
const certDir = process.env.POC_CERT_DIR ?? "/tmp/poc-330-certs";
const lanIp = process.env.POC_LAN_IP ?? "";

const handler = (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname === "/set") {
    const domain = url.searchParams.get("domain");
    const secure = url.searchParams.get("secure") === "1";
    const attrs = [`${url.searchParams.get("name") ?? "poc"}=1`, "Path=/", "SameSite=Lax"];
    if (domain) attrs.push(`Domain=${domain}`);
    if (secure) attrs.push("Secure");
    return new Response("set", { headers: { "Set-Cookie": attrs.join("; ") } });
  }
  return new Response(req.headers.get("cookie") ?? "", { headers: { "Content-Type": "text/plain" } });
};

const plain = Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: handler });
const tls = Bun.serve({
  port: TLS_PORT,
  hostname: "127.0.0.1",
  fetch: handler,
  tls: { cert: Bun.file(`${certDir}/cert.pem`), key: Bun.file(`${certDir}/key.pem`) },
});
const lan = lanIp ? Bun.serve({ port: LAN_PORT, hostname: lanIp, fetch: handler }) : undefined;

const browser = await chromium.launch({
  args: [
    "--host-resolver-rules=MAP *.taimei-code.local 127.0.0.1, MAP *.taimei-code.localhost " +      (lanIp || "127.0.0.1"),
  ],
});

type Case = { name: string; set: string; read: string; ignoreHTTPSErrors?: boolean };

const cases: Case[] = [
  {
    name: "1A localhost http __Secure- prefix",
    set: `http://localhost:${PORT}/set?secure=1&name=__Secure-poc`,
    read: `http://localhost:${PORT}/echo`,
  },
  {
    name: "1D .localhost http Domain __Secure- prefix",
    set: `http://auth.taimei-code.localhost:${PORT}/set?domain=taimei-code.localhost&secure=1&name=__Secure-poc`,
    read: `http://app.taimei-code.localhost:${PORT}/echo`,
  },
  {
    name: "1C .local https Domain __Secure- prefix",
    set: `https://auth.taimei-code.local:${TLS_PORT}/set?domain=taimei-code.local&secure=1&name=__Secure-poc`,
    read: `https://app.taimei-code.local:${TLS_PORT}/echo`,
    ignoreHTTPSErrors: true,
  },
  {
    name: "1A localhost http Secure",
    set: `http://localhost:${PORT}/set?secure=1`,
    read: `http://localhost:${PORT}/echo`,
  },
  {
    name: "1B .local http Domain (no Secure, control)",
    set: `http://auth.taimei-code.local:${PORT}/set?domain=taimei-code.local`,
    read: `http://app.taimei-code.local:${PORT}/echo`,
  },
  {
    name: "1B .local http Domain Secure",
    set: `http://auth.taimei-code.local:${PORT}/set?domain=taimei-code.local&secure=1`,
    read: `http://app.taimei-code.local:${PORT}/echo`,
  },
  {
    name: "1C .local https(self-signed) Domain Secure",
    set: `https://auth.taimei-code.local:${TLS_PORT}/set?domain=taimei-code.local&secure=1`,
    read: `https://app.taimei-code.local:${TLS_PORT}/echo`,
    ignoreHTTPSErrors: true,
  },
  {
    name: "1D .localhost http Domain Secure (resolver rule to LAN ip)",
    set: `http://auth.taimei-code.localhost:${lanIp ? LAN_PORT : PORT}/set?domain=taimei-code.localhost&secure=1`,
    read: `http://app.taimei-code.localhost:${lanIp ? LAN_PORT : PORT}/echo`,
  },
];

for (const c of cases) {
  const context = await browser.newContext({ ignoreHTTPSErrors: c.ignoreHTTPSErrors ?? false });
  const page = await context.newPage();
  try {
    await page.goto(c.set);
    const stored = (await context.cookies()).map((k) => `${k.name}@${k.domain} secure=${k.secure}`);
    await page.goto(c.read);
    const sent = (await page.textContent("body"))?.trim() ?? "";
    console.log(JSON.stringify({ case: c.name, stored, sentToOtherHost: sent }));
  } catch (error) {
    console.log(JSON.stringify({ case: c.name, error: String(error).split("\n")[0] }));
  }
  await context.close();
}

await browser.close();
plain.stop();
tls.stop();
lan?.stop();
