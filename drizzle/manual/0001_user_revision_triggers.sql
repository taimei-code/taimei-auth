-- user.revision を name/email/email_verified/image の変更で自動 ++。
-- updated_at のみの no-op update では ++ しない (DISTINCT FROM ガード)。
-- drizzle-kit は trigger を管理しないため drizzle/manual/ に分離する。
CREATE OR REPLACE FUNCTION bump_user_revision() RETURNS trigger AS $$
BEGIN
  IF (OLD.name, OLD.email, OLD.email_verified, OLD.image)
       IS DISTINCT FROM (NEW.name, NEW.email, NEW.email_verified, NEW.image) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_bump_revision_on_update ON "user";
CREATE TRIGGER user_bump_revision_on_update
  BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION bump_user_revision();

-- password change は account.password の UPDATE。user テーブル trigger では検知できないため連動。
-- OAuth signIn の access_token / refresh_token UPDATE は password IS DISTINCT FROM false で skip。
CREATE OR REPLACE FUNCTION bump_user_revision_from_account() RETURNS trigger AS $$
BEGIN
  IF OLD.password IS DISTINCT FROM NEW.password THEN
    UPDATE "user" SET revision = revision + 1 WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS account_password_change_bumps_user_revision ON "account";
CREATE TRIGGER account_password_change_bumps_user_revision
  AFTER UPDATE ON "account"
  FOR EACH ROW EXECUTE FUNCTION bump_user_revision_from_account();
