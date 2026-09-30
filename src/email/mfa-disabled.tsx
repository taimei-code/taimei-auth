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

type MfaDisabledEmailProps = {
  appName: string;
  securityUrl: string;
  supportEmail: string;
};

export default function MfaDisabledEmail({
  appName = "taimei",
  securityUrl = "https://auth.taimei-code.com/account/security",
  supportEmail = "support@taimei-code.com",
}: MfaDisabledEmailProps) {
  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>多要素認証 (MFA) を無効にしました</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.headerSection}>
            <Heading style={styles.heading}>多要素認証 (MFA) を無効にしました</Heading>

            <Text style={styles.introText}>
              {appName} のアカウントで多要素認証 (MFA) が無効になりました。
              <br />
              以後のログインでは、認証アプリのコードは求められません。
            </Text>
          </Section>

          <Section style={styles.detailSection}>
            <Text style={styles.warningText}>
              この操作に心当たりがない場合、第三者があなたのアカウントと第二要素の両方を
              手に入れている可能性があります。
              <br />
              ただちに多要素認証 (MFA) を再度有効にし、
              <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> までご連絡ください。
            </Text>
          </Section>

          <Section style={styles.buttonSection}>
            <Button href={securityUrl} style={styles.button}>
              セキュリティ設定を開く
            </Button>
          </Section>

          <Hr style={styles.divider} />

          <Section>
            <Text style={styles.secondaryText}>
              これまでに発行したリカバリーコードは無効になりました。
              <br />
              再度有効にすると、新しい認証アプリの登録とリカバリーコードの発行をやり直します。
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
