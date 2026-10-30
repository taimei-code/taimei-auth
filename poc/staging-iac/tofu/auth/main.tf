variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "neon_project_id" { type = string }
variable "neon_parent_branch_id" { type = string }
variable "poc_secret" {
  type      = string
  sensitive = true
}

provider "cloudflare" {}
provider "neon" {}

locals {
  name = "poc-iac-tofu"
}

resource "neon_branch" "staging" {
  project_id = var.neon_project_id
  parent_id  = var.neon_parent_branch_id
  name       = "${local.name}-staging"
}

resource "neon_endpoint" "staging" {
  project_id               = var.neon_project_id
  branch_id                = neon_branch.staging.id
  type                     = "read_write"
  autoscaling_limit_min_cu = 0.25
  autoscaling_limit_max_cu = 0.25
}

resource "neon_role" "app" {
  project_id = var.neon_project_id
  branch_id  = neon_branch.staging.id
  name       = "poc_iac_tofu"
  depends_on = [neon_endpoint.staging]
}

resource "neon_database" "app" {
  project_id = var.neon_project_id
  branch_id  = neon_branch.staging.id
  name       = "poc_iac_tofu"
  owner_name = neon_role.app.name
}

resource "cloudflare_hyperdrive_config" "db" {
  account_id = var.account_id
  name       = "${local.name}-hd"
  origin = {
    scheme   = "postgres"
    host     = neon_endpoint.staging.host
    port     = 5432
    database = neon_database.app.name
    user     = neon_role.app.name
    password = neon_role.app.password
  }
  caching = { disabled = true }
}

resource "cloudflare_workers_script" "auth" {
  account_id         = var.account_id
  script_name        = "${local.name}-auth"
  main_module        = "auth.js"
  content_file       = "${path.module}/../worker/auth.js"
  content_sha256     = filesha256("${path.module}/../worker/auth.js")
  compatibility_date = "2026-10-01"
  assets = {
    directory = "${path.module}/../worker/assets"
    config    = { run_worker_first = true }
  }
  bindings = [
    { name = "COUNTER", type = "durable_object_namespace", class_name = "Counter" },
    { name = "POC_SECRET", type = "secret_text", text = var.poc_secret },
    { name = "HYPERDRIVE", type = "hyperdrive", id = cloudflare_hyperdrive_config.db.id },
    { name = "ASSETS", type = "assets" },
  ]
  migrations = {
    new_tag            = "v1"
    new_sqlite_classes = ["Counter"]
  }
}

resource "cloudflare_workers_cron_trigger" "auth" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.auth.script_name
  schedules   = [{ cron = "*/30 * * * *" }]
}

resource "cloudflare_workers_custom_domain" "auth" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = "${local.name}-auth.taimei-code.com"
  service    = cloudflare_workers_script.auth.script_name
}

output "worker_name" {
  value = cloudflare_workers_script.auth.script_name
}
