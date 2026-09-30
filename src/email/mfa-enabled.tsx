import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Link } from "@react-email/link";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import * as styles from "./styles";

type MfaEnabledEmailProps = {
  appName: string;
  securityUrl: string;
  supportEmail: string;
};

// TOTP secret とリカバリーコードは本文に書かない (受信箱が第二要素になる)。
export default function MfaEnabledEmail({
  appName = "taimei",
  securityUrl = "https://auth.taimei-code.com/account/security",
  supportEmail = "support@taimei-code.com",
}: MfaEnabledEmailProps) {
  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>多要素認証 (MFA) を有効にしました</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.headerSection}>
            <Heading style={styles.heading}>多要素認証 (MFA) を有効にしました</Heading>

            <Text style={styles.introText}>
              {appName} のアカウントで多要素認証 (MFA) が有効になりました。
              <br />
              以後のログインでは、認証アプリが表示する 6 桁のコードの入力が必要になります。
            </Text>
          </Section>

          <Section style={styles.detailSection}>
            <Text style={styles.secondaryText}>
              認証アプリを使えなくなった場合は、有効化時に表示したリカバリーコードでログインできます。
            </Text>
          </Section>

          <Section style={styles.buttonSection}>
            <Button href={securityUrl} style={styles.button}>
              セキュリティ設定を確認する
            </Button>
          </Section>

          <Hr style={styles.divider} />

          <Section>
            <Text style={styles.warningText}>
              この操作に心当たりがない場合は、第三者がアカウントを操作している可能性があります。
              <br />
              <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> までご連絡ください。
            </Text>
          </Section>

          <Hr style={styles.divider} />

          <Text style={styles.copyrightText}>
            © {new Date().getFullYear()} {appName}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
