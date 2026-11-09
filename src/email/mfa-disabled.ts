import { br, button, type EmailBody, mailLink, paragraph, section } from "./layout";

export const mfaDisabledEmail = (props: {
  appName: string;
  securityUrl: string;
  supportEmail: string;
}): EmailBody => ({
  appName: props.appName,
  preview: "多要素認証 (MFA) を無効にしました",
  logo: "hidden",
  title: "多要素認証 (MFA) を無効にしました",
  intro: [
    `${props.appName} のアカウントで多要素認証 (MFA) が無効になりました。`,
    br,
    "以後のログインでは、認証アプリのコードは求められません。",
  ],
  main: [
    section(
      "detail",
      paragraph(
        "warning",
        "この操作に心当たりがない場合、第三者があなたのアカウントと第二要素の両方を 手に入れている可能性があります。",
        br,
        "ただちに多要素認証 (MFA) を再度有効にし、",
        mailLink(props.supportEmail),
        " までご連絡ください。",
      ),
    ),
    button(props.securityUrl, "セキュリティ設定を開く"),
  ],
  footer: [
    section(
      "unstyled",
      paragraph(
        "secondary",
        "これまでに発行したリカバリーコードは無効になりました。",
        br,
        "再度有効にすると、新しい認証アプリの登録とリカバリーコードの発行をやり直します。",
      ),
    ),
  ],
});
