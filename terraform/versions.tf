terraform {
  required_version = ">= 1.5.0"

  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.70"
    }
  }
}

# Auth via temporary process env vars set by the backend worker:
#   HW_ACCESS_KEY, HW_SECRET_KEY, HW_REGION_NAME
# Never hard-code AK/SK in .tf files.
provider "huaweicloud" {
  region = var.region
}
