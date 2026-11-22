import { br, button, type EmailBody, mailLink, paragraph, section, strong } from "./layout";

const PASSKEY_CHANGE_TEXTS = {
  registered: {
    title: "パスキーを登録しました",
    happened: (appName: string) => `${appName} のアカウントにパスキーが登録されました。`,
    consequence: "以後のログインでは、このパスキーを使えます。",
    remedy: "ただちにセキュリティ設定でこのパスキーを削除してください。",
  },
  deleted: {
    title: "パスキーを削除しました",
    happened: (appName: string) => `${appName} のアカウントからパスキーが削除されました。`,
    consequence: "以後のログインでは、このパスキーを使えません。",
    remedy:
      "ただちにセキュリティ設定で、心当たりのないパスキーが登録されていないかを確かめて削除してください。",
  },
} as const;

export type PasskeyChange = keyof typeof PASSKEY_CHANGE_TEXTS;

export type PasskeyChangedEmailParams = {
  readonly change: PasskeyChange;
  readonly email: string;
  readonly providerName: string | null;
};

export const passkeyChangedEmail = (
  props: Omit<PasskeyChangedEmailParams, "email"> & {
    appName: string;
    securityUrl: string;
    supportEmail: string;
  },
): EmailBody => {
  const texts = PASSKEY_CHANGE_TEXTS[props.change];
  return {
    appName: props.appName,
    preview: texts.title,
    logo: "hidden",
    title: texts.title,
    intro: [texts.happened(props.appName), br, texts.consequence],
    main: [
      section("detail", paragraph("secondary", "提供元: ", strong(props.providerName ?? "不明"))),
      button(props.securityUrl, "セキュリティ設定を開く"),
    ],
    footer: [
      section(
        "unstyled",
        paragraph(
          "warning",
          "この操作に心当たりがない場合は、第三者がアカウントを操作している可能性があります。",
          br,
          texts.remedy,
          br,
          mailLink(props.supportEmail),
          " までご連絡ください。",
        ),
      ),
    ],
  };
};
