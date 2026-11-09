import { br, button, type EmailBody, mailLink, paragraph, section } from "./layout";

export const mfaEnabledEmail = (props: {
  appName: string;
  securityUrl: string;
  supportEmail: string;
}): EmailBody => ({
  appName: props.appName,
  preview: "多要素認証 (MFA) を有効にしました",
  logo: "hidden",
  title: "多要素認証 (MFA) を有効にしました",
  intro: [
    `${props.appName} のアカウントで多要素認証 (MFA) が有効になりました。`,
    br,
    "以後のログインでは、認証アプリが表示する 6 桁のコードの入力が必要になります。",
  ],
  main: [
    section(
      "detail",
      paragraph(
        "secondary",
        "認証アプリを使えなくなった場合は、有効化時に表示したリカバリーコードでログインできます。",
      ),
    ),
    button(props.securityUrl, "セキュリティ設定を確認する"),
  ],
  footer: [
    section(
      "unstyled",
      paragraph(
        "warning",
        "この操作に心当たりがない場合は、第三者がアカウントを操作している可能性があります。",
        br,
        mailLink(props.supportEmail),
        " までご連絡ください。",
      ),
    ),
  ],
});
