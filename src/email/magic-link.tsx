import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Link } from "@react-email/link";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import * as styles from "./styles";

type MagicLinkEmailProps = {
  url: string;
  appName: string;
};

export default function MagicLinkEmail({
  url = "https://example.com/auth/magic-link?token=xxx",
  appName = "Taimei",
}: MagicLinkEmailProps) {
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
      <Preview>{appName} へのログインリンク - 5分間有効</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.logoSection}>
            <Img src={logoUrl} width="80" height="80" alt={appName} style={styles.logo} />
          </Section>

          <Section style={styles.headerSectionBelowLogo}>
            <Heading style={styles.heading}>ログインリクエスト</Heading>

            <Text style={styles.introText}>
              {appName} へのログインリンクをお送りします。
              <br />
              下のボタンをクリックしてログインしてください。
            </Text>
          </Section>

          <Section style={styles.buttonSection}>
            <Button href={url} style={styles.button}>
              ログインする
            </Button>
          </Section>

          <Text style={styles.expiryNotice}>このリンクは5分間有効です</Text>

          <Hr style={styles.divider} />

          <Section>
            <Text style={styles.smallSecondaryText}>
              ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください
            </Text>
            <Text style={styles.fallbackUrlParagraph}>
              <Link href={url} style={styles.fallbackUrlLink}>
                {url}
              </Link>
            </Text>
          </Section>

          <Section style={styles.closingNoteSection}>
            <Text style={styles.smallSecondaryText}>
              このリンクは1回のみ使用可能です。
              <br />
              心当たりのない場合は、このメールを無視してください。
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
