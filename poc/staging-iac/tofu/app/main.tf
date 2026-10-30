variable "account_id" { type = string }
variable "auth_state_path" { type = string }

provider "cloudflare" {}

data "terraform_remote_state" "auth" {
  backend = "local"
  config = {
    path = var.auth_state_path
  }
}

resource "cloudflare_workers_script" "app" {
  account_id         = var.account_id
  script_name        = "poc-iac-tofu-app"
  main_module        = "app.js"
  content_file       = "${path.module}/../worker/app.js"
  content_sha256     = filesha256("${path.module}/../worker/app.js")
  compatibility_date = "2026-10-01"
  bindings = [
    { name = "AUTH", type = "service", service = data.terraform_remote_state.auth.outputs.worker_name },
  ]
}

resource "cloudflare_workers_script_subdomain" "app" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.app.script_name
  enabled     = true
}
