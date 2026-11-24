variable "env" { type = string }

resource "terraform_data" "probe" {
  input = "probe-${var.env}"
}

output "env" {
  value = terraform_data.probe.output
}
