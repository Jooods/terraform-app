variable "region" {
  type        = string
  description = "Region ID, e.g. cn-southwest-2 (CN Southwest-Guiyang1)"
}

variable "instance_name" {
  type        = string
  description = "ECS name, e.g. ecs-7b78"
}

variable "image_id" {
  type        = string
  description = "Public/private/shared image ID from the console"
}

variable "flavor_id" {
  type        = string
  description = "Flavor name, e.g. c9.large.2"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID (informational; NIC uses subnet_id)"
}

variable "subnet_id" {
  type        = string
  description = "Primary NIC subnet / network ID"
}

variable "security_group_id" {
  type        = string
  description = "Security group ID"
}

variable "availability_zone" {
  type        = string
  description = "AZ code, e.g. cn-southwest-2a. Empty = provider default"
  default     = ""
}

variable "charging_mode" {
  type        = string
  description = "postPaid (pay-per-use) or prePaid (yearly/monthly)"
  default     = "postPaid"
}

variable "period_unit" {
  type        = string
  description = "month or year — only used when charging_mode is prePaid"
  default     = "month"
}

variable "period" {
  type        = number
  description = "Required duration — only used when charging_mode is prePaid"
  default     = 1
}

variable "auto_renew" {
  type        = bool
  description = "Auto-renew for prePaid instances"
  default     = false
}

variable "system_disk_type" {
  type        = string
  description = "SAS | SSD | GPSSD | ESSD | ..."
  default     = "SAS"
}

variable "system_disk_size" {
  type        = number
  description = "System disk size in GiB (min 40)"
  default     = 40
}

variable "data_disk_type" {
  type        = string
  description = "Optional data disk type; empty = no data disk"
  default     = ""
}

variable "data_disk_size" {
  type        = number
  description = "Optional data disk size in GiB"
  default     = 0
}

variable "key_pair" {
  type        = string
  description = "Existing key pair name for SSH login; empty if using password"
  default     = ""
}

variable "admin_pass" {
  type        = string
  description = "Password login (prefer TF_VAR_admin_pass). Empty if using key pair"
  default     = ""
  sensitive   = true
}

variable "eip_type" {
  type        = string
  description = "Empty = no EIP. 5_bgp = Dynamic BGP, 5_sbgp = Static BGP"
  default     = ""
}

variable "bandwidth_size" {
  type        = number
  description = "EIP bandwidth Mbit/s when eip_type is set"
  default     = 5
}

variable "bandwidth_charge_mode" {
  type        = string
  description = "traffic or bandwidth"
  default     = "traffic"
}

variable "enterprise_project_id" {
  type        = string
  description = "Optional enterprise project ID"
  default     = "0"
}
