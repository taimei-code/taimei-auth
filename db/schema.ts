import {
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  index,
  boolean,
  integer,
  bigint,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// membership / invitation が共有する role 値集合の SSOT。CONTEXT.md 'role'
export type Role = "OWNER" | "ADMIN" | "MEMBER";

// company / audit_log payload が共有する org_code 値集合の SSOT。CONTEXT.md 'org_code'
export type OrgCode = "PERSONAL" | "CORPORATE";

// 事業所のライフサイクル状態。CONTEXT.md 'activation_status'
export type ActivationStatus = "ACTIVE" | "DELETED";

// used_at 1 列に 3 状態を多重化せず、独立した status 列で表す。
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";

// 事業所 (課金単位)。他テーブルが参照するため declaration を先頭に置く。詳細: CONTEXT.md '事業所 / company'
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
    // 旧構成の判定源 (現構成は mfa_totp 行から導出 — ADR-0016)。デプロイ ② で削除する。
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    // 新規 session 確立時の default 候補事業所。削除済 company を参照しないよう ON DELETE SET NULL。
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
    // 現在 active な事業所。DeleteCompany (soft delete) 時の NULL 更新は handler が責任を持つ。
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

// 旧構成 (twoFactor プラグイン) の遺物。ロールバック線の維持のため温存し、デプロイ ② で DROP する
// (ADR-0016 §9)。以下は当時の設計メモ:
// better-auth twoFactor プラグイン規定のスキーマと 1:1。読まない列も削るとプラグインのロック機構が
// silent に死ぬ。export 名の camelCase は必須 (drizzle adapter が schema["twoFactor"] で引くため)。
// 不変条件: user.two_factor_enabled が true の期間、当該 user の行は 1 件かつ verified。プラグインの
// verify-totp は非トランザクショナルな 2 書き込みのため中断で破れる (分類と復旧: ADR-0013 §7)。
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
    // user あたり 1 行を DB で強制する。プラグインの enable は deleteMany + create のため並行 enroll で
    // 2 行になる窓があり、2 行では状態が一意に決まらない。UNIQUE で fail-closed (詳細: ADR-0013 §7)。
    uniqueIndex("two_factor_user_id_idx").on(table.userId),
  ],
);

// 自前 MFA (TOTP) の登録行。better-auth は複製しないため repository (db/repositories/mfa-totp.ts) 直書きが
// 正 (db/CLAUDE.md ルール 2 の Session/User 例外の対象外)。状態は行が 3 値で表す: 行なし = 未登録 /
// verified_at NULL = 登録済み未有効 / 非 NULL = 有効。flag 列は持たない (設計: ADR-0016)。
export const mfaTotp = pgTable("mfa_totp", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // MFA 登録識別子。activate はこの一致を要求する (別タブの古い登録画面からの有効化を弾く)。
  enrollmentId: text("enrollment_id").notNull(),
  // AES-256-GCM (AAD = user_id)。列は base64 文字列 — repo に bytea の前例が無いため text を踏襲。
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretIv: text("secret_iv").notNull(),
  keyVersion: integer("key_version").notNull(),
  verifiedAt: timestamp("verified_at"),
  // 受理済み timestep の単調比較対象 (リプレイ拒否)。条件付き単文 UPDATE の WHERE がこの列を見る。
  lastUsedTimestep: bigint("last_used_timestep", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mfaRecoveryCode = pgTable(
  "mfa_recovery_code",
  {
    // "NN-<uuid>"。先頭 2 桁 = 挿入順で、id 昇順の読み出しが再表示順を固定する。
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeCiphertext: text("code_ciphertext").notNull(),
    codeIv: text("code_iv").notNull(),
    keyVersion: integer("key_version").notNull(),
    // 単回消費の条件列。消費は used_at IS NULL を WHERE に含む条件付き単文 UPDATE。
    usedAt: timestamp("used_at"),
  },
  (table) => [index("mfa_recovery_code_user_id_idx").on(table.userId)],
);

export type MfaRegistrationOperationKind =
  | "enroll"
  | "restart"
  | "activate"
  | "disable"
  | "force_disable";

export const mfaRegistrationGuardProtocol = pgTable(
  "mfa_registration_guard_protocol",
  {
    protocolKey: text("protocol_key").primaryKey().notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    check(
      "mfa_registration_guard_protocol_key_check",
      sql`${table.protocolKey} = 'mfa_registration_guard'`,
    ),
    check("mfa_registration_guard_protocol_version_check", sql`${table.version} > 0`),
  ],
);

export const mfaRegistrationTransitionGuard = pgTable(
  "mfa_registration_transition_guard",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    operationToken: text("operation_token").notNull(),
    operationKind: text("operation_kind").$type<MfaRegistrationOperationKind>().notNull(),
    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "mfa_registration_guard_operation_kind_check",
      sql`${table.operationKind} in ('enroll', 'restart', 'activate', 'disable', 'force_disable')`,
    ),
  ],
);

// account_delete 後も log を残すため意図的に user_id に FK を付けない。詳細: CONTEXT.md 'audit log'
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

// 1 user × 1 company の所属関係 1 行 (N:M bridge)。company_id は誤物理削除を防ぐ ON DELETE RESTRICT。
// user_id は退会時に所属解除する CASCADE (OWNER pre-check があるため責任者不在は起きない: PR #55 → #63)。
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

// 事業所から外部 email 宛の参加打診。company の cascade 削除を許容する (dangling 招待を残さない)。
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
    // legacy alias / 派生値 (COALESCE(accepted_at, revoked_at)) の窓口。status 更新と同 transaction で set。
    usedAt: timestamp("used_at"),
    // 招待者の退会で道連れ削除 (audit_log に invitation_sent が残る)。NOT NULL のため SET NULL は不可。
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
