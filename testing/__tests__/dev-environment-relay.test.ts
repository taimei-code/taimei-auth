import { afterEach, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { connect, createServer, type Server } from "node:net";
import { join } from "node:path";

const RELAY_ENTRY = join(import.meta.dir, "../dev-environment-relay.ts");

const unusedPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  void probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve did not bind a TCP port");
  return port;
};

const listeningPort = async (server: Server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("server did not bind a TCP port");
  return address.port;
};

const opens = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const startRelay = async (destination: string) => {
  const port = unusedPort();
  const child = Bun.spawn([process.execPath, RELAY_ENTRY, destination], {
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  cleanups.push(() => {
    child.kill();
    return child.exited;
  });
  while (!(await opens(port))) {
    if (child.exitCode !== null) throw new Error(await new Response(child.stderr).text());
    await Bun.sleep(50);
  }
  return port;
};

describe("中継は、届いた接続を起動の時に渡した宛先へそのまま渡す", () => {
  test("client が送り終えて書き込みを閉じても、宛先がその後に返した応答を client に返す", async () => {
    const destination = createServer({ allowHalfOpen: true }, (socket) => {
      let request = "";
      socket.on("data", (chunk) => {
        request += chunk.toString();
      });
      socket.on("end", () => socket.end(`reply-to:${request}`));
    });
    cleanups.push(() => new Promise((resolve) => destination.close(resolve)));
    const relayPort = await startRelay(`127.0.0.1:${await listeningPort(destination)}`);

    const reply = await new Promise<string>((resolve, reject) => {
      let received = "";
      const client = connect(relayPort, "127.0.0.1", () => client.end("ping"));
      client.on("data", (chunk) => {
        received += chunk.toString();
      });
      client.on("close", () => resolve(received));
      client.on("error", reject);
    });

    expect(reply).toBe("reply-to:ping");
  });

  test.each([
    ["auth-service"],
    ["auth-service:99999"],
    [""],
  ])("宛先 %p が host と port の形でなければ、待ち受けずに 0 以外で終わり、使い方を出す", (destination) => {
    const result = Bun.spawnSync([process.execPath, RELAY_ENTRY, destination], {
      env: { ...process.env, PORT: String(unusedPort()) },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("FATAL: usage:");
  });
});
