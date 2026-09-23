locals {
  use_prepaid   = var.charging_mode == "prePaid"
  use_keypair   = var.key_pair != ""
  use_password  = var.admin_pass != ""
  use_eip       = var.eip_type != ""
  use_data_disk = var.data_disk_type != "" && var.data_disk_size > 0
}

resource "huaweicloud_compute_instance" "ecs" {
  name               = var.instance_name
  image_id           = var.image_id
  flavor_id          = var.flavor_id
  security_group_ids = [var.security_group_id]
  availability_zone  = var.availability_zone != "" ? var.availability_zone : null

  charging_mode = var.charging_mode
  period_unit   = local.use_prepaid ? var.period_unit : null
  period        = local.use_prepaid ? var.period : null
  auto_renew    = local.use_prepaid ? tostring(var.auto_renew) : null

  key_pair   = local.use_keypair ? var.key_pair : null
  admin_pass = local.use_password ? var.admin_pass : null

  network {
    uuid = var.subnet_id
  }

  system_disk_type = var.system_disk_type
  system_disk_size = var.system_disk_size

  dynamic "data_disks" {
    for_each = local.use_data_disk ? [1] : []
    content {
      type = var.data_disk_type
      size = var.data_disk_size
    }
  }

  eip_type = local.use_eip ? var.eip_type : null

  dynamic "bandwidth" {
    for_each = local.use_eip ? [1] : []
    content {
      share_type  = "PER"
      size        = var.bandwidth_size
      charge_mode = var.bandwidth_charge_mode
    }
  }

  enterprise_project_id = var.enterprise_project_id != "" ? var.enterprise_project_id : null

  tags = {
    managed_by = "automationecs"
  }

  lifecycle {
    ignore_changes = [
      admin_pass,
    ]
  }
}
