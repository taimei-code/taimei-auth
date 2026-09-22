import { describe, test } from "bun:test";
import { expectLiveMiss } from "../../__tests__/live-runner";
import { MembershipRepo } from "../ports";
import { MembershipRepoLive } from "../wiring";

describe("MembershipRepoLive", () => {
  test("存在しない membership は undefined を返す (compose Postgres)", () =>
    expectLiveMiss(
      MembershipRepo.use((repo) => repo.findMembership("no-such-user", "no-such-company")),
      MembershipRepoLive,
    ));
});
