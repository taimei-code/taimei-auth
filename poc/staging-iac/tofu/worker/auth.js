export class Counter {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS c (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)");
    this.sql.exec("INSERT OR IGNORE INTO c VALUES (1, 0)");
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/do/inc") {
      this.sql.exec("UPDATE c SET n = n + 1 WHERE id = 1");
    }
    return new Response(String(this.sql.exec("SELECT n FROM c WHERE id = 1").one().n));
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response("poc-iac-tofu-auth ok");
    if (path === "/do/inc" || path === "/do/get") {
      const stub = env.COUNTER.get(env.COUNTER.idFromName("c"));
      return stub.fetch("https://do" + path);
    }
    if (path === "/secret-length") return new Response(String(env.POC_SECRET.length));
    if (path === "/hyperdrive") return new Response(String(typeof env.HYPERDRIVE.host === "string"));
    if (path.startsWith("/static/")) return env.ASSETS.fetch("https://assets" + path);
    return new Response("not found", { status: 404 });
  },
  async scheduled() {},
};
