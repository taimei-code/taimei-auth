import { startBunServer } from "./bun-server";

const started = startBunServer();

export const app = started.app;

export default started.server;
