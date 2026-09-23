output "instance_id" {
  description = "Created ECS instance ID"
  value       = huaweicloud_compute_instance.ecs.id
}

output "instance_name" {
  description = "ECS instance name"
  value       = huaweicloud_compute_instance.ecs.name
}

output "private_ip" {
  description = "Primary private IP (Primary NIC)"
  value       = try(huaweicloud_compute_instance.ecs.network[0].fixed_ip_v4, null)
}

output "public_ip" {
  description = "Public EIP if assigned"
  value       = try(huaweicloud_compute_instance.ecs.public_ip, null)
}

output "status" {
  description = "Instance status reported by Terraform"
  value       = huaweicloud_compute_instance.ecs.status
}

output "flavor_id" {
  value = huaweicloud_compute_instance.ecs.flavor_id
}

output "availability_zone" {
  value = huaweicloud_compute_instance.ecs.availability_zone
}
