variable "account_id" { type = string }

provider "cloudflare" {}

import {
  to = cloudflare_workers_script.legacy
  id = "${var.account_id}/poc-iac-tofu-legacy"
}

import {
  to = cloudflare_workers_script_subdomain.legacy
  id = "${var.account_id}/poc-iac-tofu-legacy"
}

resource "cloudflare_workers_script" "legacy" {
  account_id         = var.account_id
  script_name        = "poc-iac-tofu-legacy"
  main_module        = "legacy.js"
  content_file       = "${path.module}/../worker/legacy.js"
  content_sha256     = filesha256("${path.module}/../worker/legacy.js")
  compatibility_date = "2026-10-01"
  bindings = [
    { name = "COUNTER", type = "durable_object_namespace", class_name = "Counter" },
  ]
}

resource "cloudflare_workers_script_subdomain" "legacy" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.legacy.script_name
  enabled     = true
}
