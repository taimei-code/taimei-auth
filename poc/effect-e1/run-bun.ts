// PoC (案 E1) を Bun runtime で走らせる。db/client.ts は process.env.DATABASE_URL があれば import 時に
// singleton pool を init する。実行: DATABASE_URL=... bun run poc/effect-e1/run-bun.ts <id>
import { program, reqStore, runtime } from "./program";

const id = process.argv[2] ?? "bun-A";
const result = await reqStore.run(id, () => runtime.runPromise(program(id)));
console.log(JSON.stringify(result));
await runtime.dispose();
process.exit(result.ok ? 0 : 1);
