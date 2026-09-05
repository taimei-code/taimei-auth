import { describe, test } from "bun:test";
import { expectLiveMiss } from "../../__tests__/live-runner";
import { UserRepo } from "../ports";
import { UserRepoLive } from "../wiring";

describe("UserRepoLive", () => {
  test("存在しない user は undefined を返す (compose Postgres)", () =>
    expectLiveMiss(
      UserRepo.use((repo) => repo.findUserById("no-such-user")),
      UserRepoLive,
    ));
});
