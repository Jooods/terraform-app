import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "../../terraform");
const WORK_ROOT = path.resolve(__dirname, "../.work");

const SENSITIVE_PATTERNS = [
  /HW_ACCESS_KEY[=:\s]+\S+/gi,
  /HW_SECRET_KEY[=:\s]+\S+/gi,
  /TF_VAR_admin_pass[=:\s]+\S+/gi,
  /access[_-]?key[=:\s]+\S+/gi,
  /secret[_-]?key[=:\s]+\S+/gi,
  /admin_pass[=:\s]+\S+/gi,
];

function redact(text) {
  let out = String(text ?? "");
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function runCommand(command, args, { cwd, env, onChunk }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      const chunk = redact(buf.toString());
      stdout += chunk;
      onChunk?.({ stream: "stdout", chunk });
    });

    child.stderr.on("data", (buf) => {
      const chunk = redact(buf.toString());
      stderr += chunk;
      onChunk?.({ stream: "stderr", chunk });
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function ensureWorkDir(jobId) {
  const dir = path.join(WORK_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });

  const entries = await fs.readdir(TEMPLATE_DIR);
  for (const name of entries) {
    if (!name.endsWith(".tf") && name !== ".terraform.lock.hcl") continue;
    await fs.copyFile(path.join(TEMPLATE_DIR, name), path.join(dir, name));
  }

  return dir;
}

function buildTfVars(config) {
  return {
    region: config.region,
    instance_name: config.instanceName,
    image_id: config.imageId,
    flavor_id: config.flavorId,
    vpc_id: config.vpcId,
    subnet_id: config.subnetId,
    security_group_id: config.securityGroupId,
    availability_zone: config.availabilityZone || "",
    charging_mode: config.chargingMode || "postPaid",
    period_unit: config.periodUnit || "month",
    period: Number(config.period) || 1,
    auto_renew: Boolean(config.autoRenew),
    system_disk_type: config.systemDiskType || "SAS",
    system_disk_size: Number(config.systemDiskSize) || 40,
    data_disk_type: config.dataDiskType || "",
    data_disk_size: Number(config.dataDiskSize) || 0,
    key_pair: config.keyPair || "",
    eip_type: config.eipType || "",
    bandwidth_size: Number(config.bandwidthSize) || 5,
    bandwidth_charge_mode: config.bandwidthChargeMode || "traffic",
  };
}

function writeTfVarsHcl(vars) {
  return Object.entries(vars)
    .map(([key, value]) => {
      if (typeof value === "number") return `${key} = ${value}`;
      if (typeof value === "boolean") return `${key} = ${value}`;
      return `${key} = ${JSON.stringify(String(value))}`;
    })
    .join("\n");
}

/**
 * Isolated Terraform worker.
 * Credentials live only in the child process env and are never written to disk.
 */
export async function runTerraformJob({
  jobId,
  accessKey,
  secretKey,
  adminPass = "",
  config,
  mode, // "validate" | "apply"
  onLog,
}) {
  const workDir = await ensureWorkDir(jobId);
  const tfvarsPath = path.join(workDir, "terraform.tfvars");
  // admin_pass is never written to disk — only TF_VAR_admin_pass in process env.
  await fs.writeFile(tfvarsPath, writeTfVarsHcl(buildTfVars(config)), "utf8");

  const env = {
    ...process.env,
    HW_ACCESS_KEY: accessKey,
    HW_SECRET_KEY: secretKey,
    HW_REGION_NAME: config.region,
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_VAR_admin_pass: adminPass || "",
  };

  const steps =
    mode === "validate"
      ? [
          ["init", ["init", "-input=false", "-no-color"]],
          ["validate", ["validate", "-no-color"]],
          ["plan", ["plan", "-input=false", "-no-color", "-out=tfplan"]],
        ]
      : [
          ["init", ["init", "-input=false", "-no-color"]],
          ["validate", ["validate", "-no-color"]],
          ["plan", ["plan", "-input=false", "-no-color", "-out=tfplan"]],
          ["apply", ["apply", "-input=false", "-no-color", "-auto-approve", "tfplan"]],
        ];

  const results = [];

  try {
    for (const [name, args] of steps) {
      onLog?.({ level: "info", message: `Running terraform ${name}…` });
      const result = await runCommand("terraform", args, {
        cwd: workDir,
        env,
        onChunk: ({ chunk }) => {
          const line = chunk.trimEnd();
          if (line) onLog?.({ level: "terraform", message: line });
        },
      });

      results.push({ step: name, ...result });

      if (result.code !== 0) {
        return {
          ok: false,
          workDir,
          failedStep: name,
          results,
          error: redact(result.stderr || result.stdout || `terraform ${name} failed`),
        };
      }
    }

    let outputs = null;
    if (mode === "apply") {
      const out = await runCommand("terraform", ["output", "-json", "-no-color"], {
        cwd: workDir,
        env,
      });
      if (out.code === 0 && out.stdout.trim()) {
        try {
          const parsed = JSON.parse(out.stdout);
          outputs = Object.fromEntries(
            Object.entries(parsed).map(([k, v]) => [k, v?.value ?? null])
          );
        } catch {
          outputs = null;
        }
      }
    }

    return { ok: true, workDir, results, outputs };
  } finally {
    // Credentials are scoped to this process env object; drop references.
    delete env.HW_ACCESS_KEY;
    delete env.HW_SECRET_KEY;
    delete env.HW_REGION_NAME;
    delete env.TF_VAR_admin_pass;
  }
}

export async function terraformAvailable() {
  try {
    const result = await runCommand("terraform", ["version", "-json"], {
      cwd: process.cwd(),
      env: process.env,
    });
    if (result.code !== 0) return { available: false, detail: redact(result.stderr) };
    try {
      const json = JSON.parse(result.stdout);
      return { available: true, version: json.terraform_version };
    } catch {
      return { available: true, version: redact(result.stdout).split("\n")[0] };
    }
  } catch (err) {
    return {
      available: false,
      detail: err?.code === "ENOENT" ? "terraform executable not found on PATH" : String(err),
    };
  }
}
