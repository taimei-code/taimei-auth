terraform {
  required_version = ">= 1.13.0"
  backend "local" {}
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }
}
