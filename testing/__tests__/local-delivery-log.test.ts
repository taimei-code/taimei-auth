import { describe, expect, test } from "bun:test";
import { invitationLogLine, magicLinkLogLine, sentLinkIn } from "../local-delivery-log";

const EMAIL = "someone@example.com";
const LOGIN_URL = "http://localhost:3110/api/auth/magic-link/verify?token=login";
const INVITATION_URL = "http://localhost:3110/api/auth/magic-link/verify?token=invitation";

describe("local で送ったメールの log の行から、宛先の最新の URL を取り出す", () => {
  test("Magic Link の行と招待のメールの行のどちらからも、書いた URL を取り出す", () => {
    expect(sentLinkIn([magicLinkLogLine(EMAIL, LOGIN_URL)], EMAIL)).toBe(LOGIN_URL);
    expect(sentLinkIn([invitationLogLine(EMAIL, INVITATION_URL)], EMAIL)).toBe(INVITATION_URL);
  });

  test("同じ宛先の行が 2 つあれば、後の行の URL を返す", () => {
    const lines = [magicLinkLogLine(EMAIL, LOGIN_URL), invitationLogLine(EMAIL, INVITATION_URL)];
    expect(sentLinkIn(lines, EMAIL)).toBe(INVITATION_URL);
  });

  test("別の宛先の行しか無ければ undefined を返す", () => {
    expect(sentLinkIn([magicLinkLogLine("other@example.com", LOGIN_URL)], EMAIL)).toBeUndefined();
  });
});
