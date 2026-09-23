// UI defaults aligned with a typical CN Southwest-Guiyang1 (cn-southwest-2) purchase.

export const REGIONS = [
  { id: "cn-southwest-2", label: "CN Southwest-Guiyang1" },
  { id: "cn-north-4", label: "CN North-Beijing4" },
  { id: "cn-east-3", label: "CN East-Shanghai1" },
  { id: "cn-south-1", label: "CN South-Guangzhou" },
  { id: "ap-southeast-1", label: "CN-Hong Kong" },
  { id: "ap-southeast-3", label: "AP-Singapore" },
];

/** AZ labels from the console for Guiyang1; codes follow Huawei AZ naming. */
export const AZ_BY_REGION = {
  "cn-southwest-2": [
    { id: "", label: "Random (provider default)" },
    { id: "cn-southwest-2a", label: "cn-southwest-2a (confirm vs console AZ1/AZ4/…)" },
    { id: "cn-southwest-2b", label: "cn-southwest-2b" },
    { id: "cn-southwest-2c", label: "cn-southwest-2c" },
    { id: "cn-southwest-2d", label: "cn-southwest-2d" },
  ],
};

export const FLAVORS = [
  { id: "c9.large.2", vcpus: 2, ram: 4, label: "c9.large.2 — 2 vCPU / 4 GiB" },
  { id: "c9.large.4", vcpus: 2, ram: 8, label: "c9.large.4 — 2 vCPU / 8 GiB" },
  { id: "c9.xlarge.2", vcpus: 4, ram: 8, label: "c9.xlarge.2 — 4 vCPU / 8 GiB" },
  { id: "c9.xlarge.4", vcpus: 4, ram: 16, label: "c9.xlarge.4 — 4 vCPU / 16 GiB" },
  { id: "c9.2xlarge.2", vcpus: 8, ram: 16, label: "c9.2xlarge.2 — 8 vCPU / 16 GiB" },
  { id: "c9.2xlarge.4", vcpus: 8, ram: 32, label: "c9.2xlarge.4 — 8 vCPU / 32 GiB" },
  { id: "c9.4xlarge.2", vcpus: 16, ram: 32, label: "c9.4xlarge.2 — 16 vCPU / 32 GiB" },
  { id: "c9.4xlarge.4", vcpus: 16, ram: 64, label: "c9.4xlarge.4 — 16 vCPU / 64 GiB" },
  { id: "c9.8xlarge.2", vcpus: 32, ram: 64, label: "c9.8xlarge.2 — 32 vCPU / 64 GiB" },
  { id: "c9.8xlarge.4", vcpus: 32, ram: 128, label: "c9.8xlarge.4 — 32 vCPU / 128 GiB" },
  { id: "c9.16xlarge.2", vcpus: 64, ram: 128, label: "c9.16xlarge.2 — 64 vCPU / 128 GiB" },
  { id: "c9.16xlarge.4", vcpus: 64, ram: 256, label: "c9.16xlarge.4 — 64 vCPU / 256 GiB" },
];

export const DISK_TYPES = [
  { id: "SAS", label: "SAS" },
  { id: "SSD", label: "SSD" },
  { id: "GPSSD", label: "General Purpose SSD (GPSSD)" },
  { id: "ESSD", label: "Extreme SSD (ESSD)" },
];

export const EIP_OPTIONS = [
  { id: "", label: "Not required" },
  { id: "5_bgp", label: "Auto assign — Dynamic BGP" },
  { id: "5_sbgp", label: "Auto assign — Static BGP" },
];

export const SAMPLE_GUIDE = {
  region: "cn-southwest-2",
  regionLabel: "CN Southwest-Guiyang1",
  flavorId: "c9.large.2",
  instanceName: "ecs-7b78",
  systemDiskType: "SAS",
  systemDiskSize: 40,
  chargingMode: "prePaid",
  period: 1,
  periodUnit: "month",
  eipType: "5_bgp",
  bandwidthSize: 5,
  bandwidthChargeMode: "bandwidth",
  notes: [
    "Image ID, VPC ID, Subnet ID, Security Group ID, and Key Pair must come from your Huawei Cloud project (console → copy ID).",
    "Security group should allow SSH (22) / RDP (3389) / ICMP only from trusted sources — avoid 0.0.0.0/0 on those ports.",
    "Region cannot be changed after the ECS is created.",
  ],
};
