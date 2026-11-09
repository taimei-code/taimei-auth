import { br, button, type EmailBody, paragraph, section } from "./layout";
import type { DisplayText } from "./sanitize";

export const welcomeEmail = (props: {
  appName: string;
  userName: DisplayText;
  dashboardUrl: string;
}): EmailBody => ({
  appName: props.appName,
  preview: `${props.appName} へようこそ！アカウント作成が完了しました`,
  logo: "shown",
  title: props.userName === "" ? "ようこそ、" : `ようこそ、${props.userName} さん`,
  intro: [
    `${props.appName} へのご登録ありがとうございます。`,
    br,
    "アカウントの作成が完了しました。",
  ],
  main: [button(props.dashboardUrl, "ダッシュボードへ")],
  footer: [
    section(
      "unstyled",
      paragraph("secondary", "ご不明な点がございましたら、", br, "お気軽にお問い合わせください。"),
    ),
  ],
});
