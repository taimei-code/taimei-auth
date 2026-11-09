import {
  br,
  button,
  type EmailBody,
  fallbackUrl,
  mailLink,
  paragraph,
  section,
  strong,
  urlLink,
} from "./layout";
import type { DisplayText } from "./sanitize";

export const invitationEmail = (props: {
  url: string;
  appName: string;
  companyName: DisplayText;
  inviterName: DisplayText;
  inviterEmail: DisplayText;
  inviteeEmail: string;
  roleLabel: string;
  supportEmail: string;
  abuseUrl: string;
}): EmailBody => ({
  appName: props.appName,
  preview: `${props.inviterName} さんから「${props.companyName}」への招待`,
  logo: "hidden",
  title: "事業所への招待",
  intro: [
    `${props.inviterName} さん (${props.inviterEmail}) から`,
    br,
    `「${props.companyName}」への参加 (${props.roleLabel}) に招待されています。`,
  ],
  main: [
    button(props.url, "招待を受諾する"),
    paragraph("expiryNotice", "この招待リンクは24時間有効です"),
    section(
      "detail",
      paragraph(
        "secondary",
        "この招待は ",
        strong(props.inviteeEmail),
        " 宛です。",
        br,
        "受諾には同じメールアドレスでのログインが必要です。",
      ),
    ),
  ],
  footer: [
    section(
      "unstyled",
      paragraph(
        "smallSecondary",
        "ボタンが機能しない場合は、以下の URL をブラウザに貼り付けてください。 URL が auth.taimei-code.com で始まることを確認してください。",
      ),
      fallbackUrl(props.url),
    ),
    section(
      "closingNote",
      paragraph(
        "smallSecondary",
        "招待に心当たりがない場合は、このメールを無視してください。",
        br,
        "不審なメールは ",
        mailLink(props.supportEmail),
        " までご連絡ください。",
        br,
        "IT 管理者向け SPF/DKIM 情報: ",
        urlLink(props.abuseUrl),
      ),
    ),
  ],
});
