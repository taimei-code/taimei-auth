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

// ADR-009: 事業所 (課金単位)。詳細: CONTEXT.md '事業所 / company'
// user / session / membership / invitation が参照するため declaration を先頭に置く。
export const company = pgTable("company", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  // 'PERSONAL' (個人事業主) | 'CORPORATE' (法人)
  orgCode: text("org_code").notNull(),
  // 'ACTIVE' | 'DELETED'。物理削除は本 ADR スコープ外 (CONTEXT.md 'activation_status')。
  activationStatus: text("activation_status").notNull().default("ACTIVE"),
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
    // ADR-009: 新規 session 確立時の default 候補事業所 (proto User.default_company_id 対応)。
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
    // ADR-009: 現在 active な事業所 (proto Session.company_id 対応)。
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

// ADR-009: 1 user × 1 company の所属関係 1 行。N:M bridge。
// 誤物理削除を防ぐため company / user 両方の FK は ON DELETE RESTRICT。
export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    // 'OWNER' | 'ADMIN' | 'MEMBER' (CONTEXT.md 'role')
    role: text("role").notNull(),
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

// ADR-009: 事業所から外部 email 宛の参加打診 1 件。受諾されると membership 行が新規作成される。
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
    role: text("role").notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    // 'PENDING' | 'ACCEPTED' | 'REVOKED' (NC3 結論: used_at 1 列多重化を避ける)
    status: text("status").notNull().default("PENDING"),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    // legacy alias / 派生値 (COALESCE(accepted_at, revoked_at)) を入れる窓口。
    // accept / revoke handler が status 更新と同 transaction で set する。
    usedAt: timestamp("used_at"),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
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
