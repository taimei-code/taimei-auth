import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../client";
import { softDeleteCompany } from "../repositories/company";
import { findActiveMembershipsByUserId, findMembersByCompanyId } from "../repositories/membership";
import { membership } from "../schema";
import { createSeed } from "../testing/seed";

const P = "memread-test-";
const seed = createSeed(P);
const at = (iso: string) => new Date(iso);

describe("所属の読み出しは ACTIVE な事業所だけを、参加の古い順に返す", () => {
  beforeEach(seed.cleanup);
  afterAll(seed.cleanup);

  test("findActiveMembershipsByUserId は DELETED の事業所の所属を返さず、ACTIVE な所属を参加の古い順に返す", async () => {
    const user = await seed.seedUser("active");
    const newer = await seed.seedCompany("newer");
    const deleted = await seed.seedCompany("deleted");
    const older = await seed.seedCompany("older");
    await seed.seedMembership(user.id, newer, "MEMBER", at("2026-03-01T00:00:00Z"));
    await seed.seedMembership(user.id, deleted, "MEMBER", at("2026-02-01T00:00:00Z"));
    await seed.seedMembership(user.id, older, "MEMBER", at("2026-01-01T00:00:00Z"));
    await softDeleteCompany(deleted);

    const rows = await findActiveMembershipsByUserId(user.id);

    expect(rows.map((row) => row.companyId)).toEqual([older, newer]);
  });

  test("findMembersByCompanyId は登録の順ではなく参加の古い順にメンバーを返す", async () => {
    const companyId = await seed.seedCompany("members");
    const third = await seed.seedUser("third");
    const second = await seed.seedUser("second");
    const first = await seed.seedUser("first");
    await seed.seedMembership(third.id, companyId, "MEMBER", at("2026-03-01T00:00:00Z"));
    await seed.seedMembership(second.id, companyId, "MEMBER", at("2026-02-01T00:00:00Z"));
    await seed.seedMembership(first.id, companyId, "MEMBER", at("2026-01-01T00:00:00Z"));

    const members = await findMembersByCompanyId(companyId);

    expect(members.map((member) => member.userId)).toEqual([first.id, second.id, third.id]);
  });

  test("findMembersByCompanyId は参加の時刻が同じメンバーを membership の id の順に返す", async () => {
    const companyId = await seed.seedCompany("tie");
    const late = await seed.seedUser("tie-late");
    const early = await seed.seedUser("tie-early");
    const joinedAt = at("2026-01-01T00:00:00Z");
    await db.insert(membership).values([
      { id: `${P}mbr-2`, userId: late.id, companyId, role: "MEMBER", joinedAt },
      { id: `${P}mbr-1`, userId: early.id, companyId, role: "MEMBER", joinedAt },
    ]);

    const members = await findMembersByCompanyId(companyId);

    expect(members.map((member) => member.userId)).toEqual([early.id, late.id]);
  });
});
