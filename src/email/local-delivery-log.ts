const magicLinkLogPrefix = (email: string): string => `[TEST] Magic Link for ${email}: `;

const invitationLogPrefix = (email: string): string => `[TEST] Invitation email for ${email}: `;

export const WELCOME_EMAIL_LOG = "[TEST] Welcome email for";

export const magicLinkLogLine = (email: string, url: string): string =>
  `${magicLinkLogPrefix(email)}${url}`;

export const invitationLogLine = (email: string, url: string): string =>
  `${invitationLogPrefix(email)}${url}`;

export const sentLinkIn = (lines: readonly string[], email: string): string | undefined => {
  const prefixes = [magicLinkLogPrefix(email), invitationLogPrefix(email)];
  for (const line of lines.toReversed()) {
    const prefix = prefixes.find((candidate) => line.includes(candidate));
    if (prefix) return line.slice(line.indexOf(prefix) + prefix.length).trim();
  }
  return undefined;
};
