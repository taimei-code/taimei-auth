variable "peer_state_path" { type = string }

data "terraform_remote_state" "peer" {
  backend = "local"
  config = {
    path = var.peer_state_path
  }
}

output "peer_env" {
  value = data.terraform_remote_state.peer.outputs.env
}
