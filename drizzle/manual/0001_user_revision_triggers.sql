-- name、email、email_verified、image のいずれかが変わった時に user.revision を自動で 1 増やす。
-- updated_at だけが変わる実質的に変更の無い update では増やさない (DISTINCT FROM で防ぐ)。
-- drizzle-kit は trigger を管理しないため drizzle/manual/ に分けて置く。
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

-- password の変更は account.password の UPDATE として起きる。user テーブルの trigger では検知できないため、account 側から連動させる。
-- OAuth の signIn で access_token や refresh_token が UPDATE される時は、password IS DISTINCT FROM が false になるため何もしない。
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
