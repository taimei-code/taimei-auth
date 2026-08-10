import {
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  index,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// membership / invitation が共有する role 値集合の SSOT。CONTEXT.md 'role'
export type Role = "OWNER" | "ADMIN" | "MEMBER";

// company / audit_log payload が共有する org_code 値集合の SSOT。CONTEXT.md 'org_code'
export type OrgCode = "PERSONAL" | "CORPORATE";

// 事業所のライフサイクル状態。CONTEXT.md 'activation_status'
export type ActivationStatus = "ACTIVE" | "DELETED";

// used_at 1 列に 3 状態を多重化せず、独立した status 列で表す。
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";

// 事業所 (課金単位)。詳細: CONTEXT.md '事業所 / company'
// user / session / membership / invitation が参照するため declaration を先頭に置く。
export const company = pgTable("company", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  orgCode: text("org_code").$type<OrgCode>().notNull(),
  activationStatus: text("activation_status").$type<ActivationStatus>().notNull().default("ACTIVE"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    revision: integer("revision").notNull().default(0),
    // MFA チャレンジ要否の唯一の判定源 (不変条件は twoFactor テーブル定義に記載)。
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    // 新規 session 確立時の default 候補事業所 (proto User.default_company_id 対応)。
    // 削除済 company を参照しないよう ON DELETE SET NULL。
    lastUsedCompanyId: text("last_used_company_id").references(() => company.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_email_key").using("btree", table.email.asc().nullsLast().op("text_ops")),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 現在 active な事業所 (proto Session.company_id 対応)。
    // DeleteCompany (soft delete) 時にこの列を NULL に更新する handler が責任を持つ。
    currentCompanyId: text("current_company_id").references(() => company.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("session_userId_idx").on(table.userId),
    index("session_revoked_at_idx").on(table.revokedAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey().notNull(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// better-auth twoFactor プラグイン規定のスキーマ (node_modules/better-auth/dist/plugins/
// two-factor/schema.mjs と 1:1)。自前コードが読まない列も、削るとプラグイン側のロック機構が
// silent に死ぬか毎回 500 になるため落とさない。export 名の camelCase は必須 — drizzle adapter が
// schema["twoFactor"] で引くため、snake_case にすると起動時に BetterAuthError で落ちる。
// 不変条件: user.two_factor_enabled が true の期間、当該 user の行は 1 件かつ verified
// (プラグインが verify-totp 成功時に両者を同時に更新する)。
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey().notNull(),
    // 実体は AUTH_SECRET 由来の鍵による可逆暗号。列名に反して平文では読めない。
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    // ADR-0010 の物理削除ライフサイクルに乗せ、退会時に道連れで消す。
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true).notNull(),
    // プラグインが SQL の +1 で更新するため、NULL を許すと加算結果が NULL になりロックが発火しない。
    failedVerificationCount: integer("failed_verification_count").default(0).notNull(),
    lockedUntil: timestamp("locked_until"),
  },
  (table) => [
    index("two_factor_secret_idx").on(table.secret),
    index("two_factor_user_id_idx").on(table.userId),
  ],
);

// account_delete 後も log を残すため意図的に user_id に FK を付けない (cascade delete を回避)。
// 詳細: CONTEXT.md 'audit log'
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey().notNull(),
    eventType: text("event_type").notNull(),
    userId: text("user_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_user_id_idx").on(table.userId),
    index("audit_log_created_at_idx").on(table.createdAt.desc()),
  ],
);

// 1 user × 1 company の所属関係 1 行。N:M bridge。
// company_id は誤物理削除を防ぐため ON DELETE RESTRICT (company は soft delete のみ)。
// user_id は account 削除時に所属解除する ON DELETE CASCADE (退会の事前 OWNER pre-check が
// OWNER 不在 company を防ぐため、cascade しても課金責任者不在は発生しない: PR #55 → #63)。
export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    role: text("role").$type<Role>().notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("membership_user_company_key").on(table.userId, table.companyId),
    index("membership_company_id_idx").on(table.companyId),
    index("membership_user_id_idx").on(table.userId),
  ],
);

// 事業所から外部 email 宛の参加打診 1 件。受諾されると membership 行が新規作成される。
// company の cascade で削除されることを許容する (= 削除済事業所への dangling 招待を持ち越さない)。
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey().notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // 招待時に付与する role (= 受諾後の membership.role に become)
    role: text("role").$type<Role>().notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    status: text("status").$type<InvitationStatus>().notNull().default("PENDING"),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    // legacy alias / 派生値 (COALESCE(accepted_at, revoked_at)) を入れる窓口。
    // accept / revoke handler が status 更新と同 transaction で set する。
    usedAt: timestamp("used_at"),
    // 招待者が退会したら、その人が出した invitation 行も道連れに削除する (audit_log に
    // invitation_sent が残るため操作行の消失は許容)。NOT NULL のため SET NULL は不可。
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("invitation_company_id_idx").on(table.companyId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(membership),
  lastUsedCompany: one(company, {
    fields: [user.lastUsedCompanyId],
    references: [company.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
  currentCompany: one(company, {
    fields: [session.currentCompanyId],
    references: [company.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const companyRelations = relations(company, ({ many }) => ({
  memberships: many(membership),
  invitations: many(invitation),
}));

export const membershipRelations = relations(membership, ({ one }) => ({
  user: one(user, {
    fields: [membership.userId],
    references: [user.id],
  }),
  company: one(company, {
    fields: [membership.companyId],
    references: [company.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  company: one(company, {
    fields: [invitation.companyId],
    references: [company.id],
  }),
  invitedBy: one(user, {
    fields: [invitation.invitedByUserId],
    references: [user.id],
  }),
}));
