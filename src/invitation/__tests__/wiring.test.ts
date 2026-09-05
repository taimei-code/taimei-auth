import { describe, test } from "bun:test";
import { expectLiveMiss } from "../../__tests__/live-runner";
import { InvitationRepo } from "../ports";
import { InvitationRepoLive } from "../wiring";

describe("InvitationRepoLive", () => {
  test("存在しない token は undefined を返す (compose Postgres)", () =>
    expectLiveMiss(
      InvitationRepo.use((repo) => repo.findByToken("no-such-token")),
      InvitationRepoLive,
    ));
});
