import { connect, createServer } from "node:net";

const isPort = (value: number) => Number.isInteger(value) && value > 0 && value < 65536;

const target = process.argv[2] ?? "";
const [, host = "", targetPort = ""] = /^(.+):(\d+)$/.exec(target) ?? [];
const port = Number(targetPort);
const listenPort = Number(process.env.PORT);

if (!host || !isPort(port) || !isPort(listenPort)) {
  console.error("FATAL: usage: PORT=<port> bun testing/dev-environment-relay.ts <host>:<port>");
  process.exit(1);
}

process.on("SIGTERM", () => process.exit(0));

createServer({ allowHalfOpen: true }, (fromConsumer) => {
  const toDevEnvironment = connect({ port, host, allowHalfOpen: true });
  fromConsumer.pipe(toDevEnvironment);
  toDevEnvironment.pipe(fromConsumer);
  fromConsumer.on("error", () => toDevEnvironment.destroy());
  toDevEnvironment.on("error", (error) => {
    console.error(`開発環境 (${target}) に届かない: ${error.message}`);
    fromConsumer.destroy();
  });
}).listen(listenPort, "0.0.0.0");
