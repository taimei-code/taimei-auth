import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "@taimei-code/auth-client";
import { br, button, type EmailBody, fallbackUrl, paragraph, section } from "./layout";

const EXPIRES_IN_MINUTES = MAGIC_LINK_EXPIRES_IN_SECONDS / 60;

export const magicLinkEmail = (props: { url: string; appName: string }): EmailBody => ({
  appName: props.appName,
  preview: `${props.appName} へのログインリンク - ${EXPIRES_IN_MINUTES}分間有効`,
  logo: "shown",
  title: "ログインリクエスト",
  intro: [
    `${props.appName} へのログインリンクをお送りします。`,
    br,
    "下のボタンをクリックしてログインしてください。",
  ],
  main: [
    button(props.url, "ログインする"),
    paragraph("expiryNotice", `このリンクは${EXPIRES_IN_MINUTES}分間有効です`),
  ],
  footer: [
    section(
      "unstyled",
      paragraph(
        "smallSecondary",
        "ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください",
      ),
      fallbackUrl(props.url),
    ),
    section(
      "closingNote",
      paragraph(
        "smallSecondary",
        "このリンクは1回のみ使用可能です。",
        br,
        "心当たりのない場合は、このメールを無視してください。",
      ),
    ),
  ],
});
