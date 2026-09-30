import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import * as styles from "./styles";
import type { DisplayText } from "./sanitize";

type WelcomeEmailProps = {
  appName: string;
  userName: DisplayText;
  dashboardUrl: string;
};

export default function WelcomeEmail({
  appName = "Taimei",
  userName,
  dashboardUrl = "https://example.com/dashboard",
}: WelcomeEmailProps) {
  const greeting = userName ? `${userName} さん` : "";
  const logoUrl =
    "https://7iv4djergayei7gf.public.blob.vercel-storage.com/taimei/public/my-service-logo.png";

  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>{appName} へようこそ！アカウント作成が完了しました</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.logoSection}>
            <Img src={logoUrl} width="80" height="80" alt={appName} style={styles.logo} />
          </Section>

          <Section style={styles.headerSectionBelowLogo}>
            <Heading style={styles.heading}>ようこそ、{greeting}</Heading>

            <Text style={styles.introText}>
              {appName} へのご登録ありがとうございます。
              <br />
              アカウントの作成が完了しました。
            </Text>
          </Section>

          <Section style={styles.buttonSection}>
            <Button href={dashboardUrl} style={styles.button}>
              ダッシュボードへ
            </Button>
          </Section>

          <Hr style={styles.divider} />

          <Section>
            <Text style={styles.secondaryText}>
              ご不明な点がございましたら、
              <br />
              お気軽にお問い合わせください。
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
