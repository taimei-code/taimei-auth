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
import type { DisplayText } from "./sanitize";

type InvitationEmailProps = {
  url: string;
  appName: string;
  companyName: DisplayText;
  inviterName: DisplayText;
  inviterEmail: DisplayText;
  inviteeEmail: string;
  roleLabel: string;
  supportEmail: string;
  abuseUrl: string;
};

export default function InvitationEmail({
  url = "https://auth.taimei-code.com/api/auth/magic-link/verify?token=xxx",
  appName = "taimei",
  companyName,
  inviterName,
  inviterEmail,
  inviteeEmail = "invitee@example.com",
  roleLabel = "メンバー",
  supportEmail = "support@taimei-code.com",
  abuseUrl = "https://taimei-code.com/security",
}: InvitationEmailProps) {
  return (
    <Html lang="ja">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>
        {inviterName} さんから「{companyName}」への招待
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.headerSection}>
            <Heading style={styles.heading}>事業所への招待</Heading>
            <Text style={styles.introText}>
              {inviterName} さん ({inviterEmail}) から
              <br />「{companyName}」への参加 ({roleLabel}) に招待されています。
            </Text>
          </Section>

          <Section style={styles.buttonSection}>
            <Button href={url} style={styles.button}>
              招待を受諾する
            </Button>
          </Section>

          <Text style={styles.expiryNotice}>この招待リンクは24時間有効です</Text>

          <Section style={styles.detailSection}>
            <Text style={styles.secondaryText}>
              この招待は <strong>{inviteeEmail}</strong> 宛です。
              <br />
              受諾には同じメールアドレスでのログインが必要です。
            </Text>
          </Section>

          <Hr style={styles.divider} />

          <Section>
            <Text style={styles.smallSecondaryText}>
              ボタンが機能しない場合は、以下の URL をブラウザに貼り付けてください。 URL が
              auth.taimei-code.com で始まることを確認してください。
            </Text>
            <Text style={styles.fallbackUrlParagraph}>
              <Link href={url} style={styles.fallbackUrlLink}>
                {url}
              </Link>
            </Text>
          </Section>

          <Section style={styles.closingNoteSection}>
            <Text style={styles.smallSecondaryText}>
              招待に心当たりがない場合は、このメールを無視してください。
              <br />
              不審なメールは <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>{" "}
              までご連絡ください。
              <br />
              IT 管理者向け SPF/DKIM 情報: <Link href={abuseUrl}>{abuseUrl}</Link>
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
