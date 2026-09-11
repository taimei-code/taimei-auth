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
import { inArray, relations } from "drizzle-orm";

// 用語の正本: CONTEXT.md (role / org_code / activation_status / 事業所 / audit log)
export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export type OrgCode = "PERSONAL" | "CORPORATE";

export type ActivationStatus = "ACTIVE" | "DELETED";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";

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
    // DeleteCompany は soft delete で ON DELETE が発火しないため、NULL 更新は handler が行う。
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

export const mfaTotp = pgTable("mfa_totp", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  enrollmentId: text("enrollment_id").notNull(),
  // AES-256-GCM (AAD = user_id)。列は base64 文字列 — repo に bytea の前例が無いため text を踏襲。
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretIv: text("secret_iv").notNull(),
  keyVersion: integer("key_version").notNull(),
  verifiedAt: timestamp("verified_at"),
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

// account_delete 後も log を残すため意図的に user_id に FK を付けない
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
    // inlineParams が無いと drizzle-kit は値を $1.. の placeholder で SQL に出し、CHECK が壊れる。
    check("membership_role_check", inArray(table.role, ROLES).inlineParams()),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey().notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    status: text("status").$type<InvitationStatus>().notNull().default("PENDING"),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    // status の派生値 (COALESCE(accepted_at, revoked_at))。status 更新と同 transaction で set。
    usedAt: timestamp("used_at"),
    // 招待者の退会で道連れ削除 (NOT NULL のため SET NULL は不可)。
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("invitation_company_id_idx").on(table.companyId),
    index("invitation_email_idx").on(table.email),
    check("invitation_role_check", inArray(table.role, ROLES).inlineParams()),
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
