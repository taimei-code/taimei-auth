const name = process.env.SERVER_NAME ?? "unknown";
const port = Number(process.env.PORT ?? 3100);

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(request) {
    const url = new URL(request.url);
    const cookie = request.headers.get("cookie") ?? "";
    console.log(JSON.stringify({ server: name, path: url.pathname, host: request.headers.get("host"), cookie }));
    if (url.pathname === "/set") {
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "__Secure-session=s1; Secure; HttpOnly; Path=/; SameSite=Lax; Domain=taimei-code.localhost");
      headers.append("set-cookie", "plain=p1; Path=/; SameSite=Lax; Domain=taimei-code.localhost");
      return new Response(`${name} set`, { headers });
    }
    return new Response(`${name} cookie=[${cookie}]`);
  },
});
console.log(`${name} listening on ${port}`);
