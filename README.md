# ECS Deploy — Huawei Cloud

Interactive UI + backend that deploys Huawei Cloud ECS via an isolated Terraform worker.

## Architecture

```
Browser UI
   |  HTTPS (POST body — never query strings)
   v
Backend API
   |  Inject AK/SK as temporary env vars
   v
Isolated Terraform Worker
   |
   v
Huawei Cloud ECS
```

Official Huawei Cloud Terraform provider auth uses:

- `HW_ACCESS_KEY`
- `HW_SECRET_KEY`
- `HW_REGION_NAME`

Credentials are **not** written into `.tf` files.

## Security rules enforced here

| Rule | How |
|------|-----|
| Browser never runs Terraform | Only the API worker spawns `terraform` |
| SK not in local storage | React state only |
| Credentials not in URLs | JSON POST body to `/api/validate` and `/api/deploy` |
| Credentials not in logs | Response payloads omit secrets; worker redacts sensitive patterns |
| Unset after use | Env keys deleted when the worker finishes |

AK/SK authenticate the call. You still need region, image ID, flavor ID, VPC ID, subnet ID, and security group ID. The IAM user behind the AK/SK must be allowed to create/manage those resources.

## Prerequisites

- Node.js 18+
- [Terraform](https://developer.hashicorp.com/terraform/install) on `PATH`
- Huawei Cloud AK/SK with ECS permissions
- Existing VPC / subnet / security group / image / flavor IDs in your project

## Sample console mapping (Guiyang1)

From a typical purchase screen:

| Console | Value used here |
|---------|-----------------|
| Region | CN Southwest-Guiyang1 → `cn-southwest-2` |
| Billing | Yearly/Monthly → `prePaid` |
| Flavor | `c9.large.2` (2 vCPU / 4 GiB) |
| ECS name | e.g. `ecs-7b78` |
| System disk | 40 GiB (SAS / SSD / GPSSD / ESSD) |
| EIP | Auto assign Dynamic BGP → `5_bgp` |
| Login | Key pair name **or** password |

You still paste **Image ID**, **VPC ID**, **Subnet ID**, and **Security Group ID** from your project — those are account-specific UUIDs.

## Quick start

```bash
npm run install:all
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:8787  

Production-style (build UI, serve from API):

```bash
npm run install:all
npm run build
npm start
```

## API

### `POST /api/validate`

Runs `terraform init` → `validate` → `plan`.

### `POST /api/deploy`

Runs `init` → `validate` → `plan` → `apply -auto-approve`.

Body (JSON):

```json
{
  "accessKey": "...",
  "secretKey": "...",
  "region": "cn-southwest-2",
  "chargingMode": "prePaid",
  "period": 1,
  "periodUnit": "month",
  "autoRenew": false,
  "availabilityZone": "cn-southwest-2a",
  "instanceName": "ecs-7b78",
  "imageId": "...",
  "flavorId": "c9.large.2",
  "vpcId": "...",
  "subnetId": "...",
  "securityGroupId": "...",
  "systemDiskType": "SAS",
  "systemDiskSize": 40,
  "dataDiskType": "",
  "dataDiskSize": 0,
  "loginMode": "keypair",
  "keyPair": "my-keypair",
  "eipType": "5_bgp",
  "bandwidthSize": 5,
  "bandwidthChargeMode": "bandwidth"
}
```

### `GET /api/jobs/:id`

Poll status, redacted logs, and outputs (no secrets).

### `GET /api/health`

Reports whether Terraform is available on the server.

## Worker command sequence

Equivalent to:

```bash
export HW_ACCESS_KEY="$REQUEST_ACCESS_KEY"
export HW_SECRET_KEY="$REQUEST_SECRET_KEY"
export HW_REGION_NAME="$REQUEST_REGION"

terraform init
terraform validate
terraform plan -out=tfplan
terraform apply -auto-approve tfplan

unset HW_ACCESS_KEY
unset HW_SECRET_KEY
unset HW_REGION_NAME
```

Each job copies the `terraform/` templates into `backend/.work/<jobId>/` so runs stay isolated.
