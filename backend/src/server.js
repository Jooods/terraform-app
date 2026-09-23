import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { runTerraformJob, terraformAvailable } from "./terraformWorker.js";
import { runWindowsAutomationJob } from "./windowsWorker.js";
import { lookup } from "./huaweiLookup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const jobs = new Map();

const REQUIRED_FIELDS = [
  "accessKey",
  "secretKey",
  "region",
  "instanceName",
  "imageId",
  "flavorId",
  "vpcId",
  "subnetId",
  "securityGroupId",
];

function publicJob(job) {
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    logs: job.logs,
    error: job.error,
    outputs: job.outputs,
    config: job.config,
  };
}

function validateBody(body) {
  const missing = REQUIRED_FIELDS.filter((f) => !String(body?.[f] ?? "").trim());
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}` };
  }
  if (String(body.instanceName).length > 64) {
    return { ok: false, error: "instanceName must be 64 characters or fewer" };
  }
  const loginMode = body.loginMode === "password" ? "password" : "keypair";
  if (loginMode === "keypair" && !String(body.keyPair ?? "").trim()) {
    return { ok: false, error: "keyPair is required when loginMode is keypair" };
  }
  if (loginMode === "password" && String(body.adminPass ?? "").length < 8) {
    return { ok: false, error: "adminPass must be at least 8 characters" };
  }
  return { ok: true };
}

function stripSecrets(body) {
  const {
    accessKey: _ak,
    secretKey: _sk,
    ...rest
  } = body;
  return rest;
}

function createJob({ mode, body }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const job = {
    id,
    mode,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    logs: [],
    error: null,
    outputs: null,
    config: {
      region: body.region.trim(),
      instanceName: body.instanceName.trim(),
      imageId: body.imageId.trim(),
      flavorId: body.flavorId.trim(),
      vpcId: body.vpcId.trim(),
      subnetId: body.subnetId.trim(),
      securityGroupId: body.securityGroupId.trim(),
      availabilityZone: String(body.availabilityZone || "").trim(),
      chargingMode: body.chargingMode === "prePaid" ? "prePaid" : "postPaid",
      periodUnit: body.periodUnit === "year" ? "year" : "month",
      period: Number(body.period) || 1,
      autoRenew: Boolean(body.autoRenew),
      systemDiskType: String(body.systemDiskType || "SAS").trim(),
      systemDiskSize: Number(body.systemDiskSize) || 40,
      dataDiskType: String(body.dataDiskType || "").trim(),
      dataDiskSize: Number(body.dataDiskSize) || 0,
      loginMode: body.loginMode === "password" ? "password" : "keypair",
      keyPair: String(body.keyPair || "").trim(),
      eipType: String(body.eipType || "").trim(),
      bandwidthSize: Number(body.bandwidthSize) || 5,
      bandwidthChargeMode:
        body.bandwidthChargeMode === "bandwidth" ? "bandwidth" : "traffic",
    },
    // Kept only in memory for the worker; never returned via API.
    _credentials: {
      accessKey: body.accessKey.trim(),
      secretKey: body.secretKey.trim(),
      adminPass: String(body.adminPass || ""),
    },
  };
  jobs.set(id, job);
  return job;
}

function appendLog(job, entry) {
  job.logs.push({
    ts: new Date().toISOString(),
    level: entry.level || "info",
    message: entry.message,
  });
  job.updatedAt = new Date().toISOString();
}

async function executeJob(job) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  appendLog(job, { level: "info", message: `Job ${job.mode} started` });

  try {
    const result = await runTerraformJob({
      jobId: job.id,
      accessKey: job._credentials.accessKey,
      secretKey: job._credentials.secretKey,
      adminPass: job._credentials.adminPass,
      config: job.config,
      mode: job.mode,
      onLog: (entry) => appendLog(job, entry),
    });

    // Drop secrets as soon as the worker returns.
    job._credentials = null;

    if (!result.ok) {
      job.status = "failed";
      job.error = result.error || `Failed at step: ${result.failedStep}`;
      appendLog(job, { level: "error", message: job.error });
      return;
    }

    job.status = job.mode === "validate" ? "validated" : "succeeded";
    job.outputs = result.outputs;
    appendLog(job, {
      level: "info",
      message:
        job.mode === "validate"
          ? "Validation and plan completed successfully"
          : "Deployment completed successfully",
    });
  } catch (err) {
    job._credentials = null;
    job.status = "failed";
    job.error = err?.message || String(err);
    if (err?.code === "ENOENT") {
      job.error =
        "Terraform is not installed or not on PATH. Install Terraform, then retry.";
    }
    appendLog(job, { level: "error", message: job.error });
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

async function executeWindowsJob(job) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  appendLog(job, { level: "info", message: `Windows Automation Job started for ${job.config.host}` });

  try {
    const result = await runWindowsAutomationJob({
      jobId: job.id,
      host: job.config.host,
      adminPass: job._credentials.adminPass,
      repoUrl: job.config.repoUrl,
      branch: job.config.branch || "main",
      githubToken: job.config.githubToken || "",
      onLog: (entry) => appendLog(job, entry),
    });

    job._credentials = null;

    if (!result.ok) {
      job.status = "failed";
      job.error = result.error || "Windows automation failed";
      job.outputs = result.outputs || null;
      if (result.script && job.outputs) {
        job.outputs.script = result.script;
      }
      appendLog(job, { level: "error", message: job.error });
      return;
    }

    job.status = "succeeded";
    job.outputs = result.outputs;
    if (result.script) {
      job.outputs.script = result.script;
    }
    appendLog(job, {
      level: "info",
      message: `Windows automation completed. Live URL: ${result.websiteUrl}`,
    });
  } catch (err) {
    job._credentials = null;
    job.status = "failed";
    job.error = err?.message || String(err);
    appendLog(job, { level: "error", message: job.error });
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", async (_req, res) => {
  const tf = await terraformAvailable();
  res.json({
    ok: true,
    service: "automationecs-api",
    terraform: tf,
  });
});

// ── Resource lookup via Huawei Cloud SDK (credentials used transiently) ──
const LOOKUP_REQUIRED = ["accessKey", "secretKey", "region", "resource"];
const VALID_RESOURCES = [
  "flavors",
  "images",
  "azs",
  "vpcs",
  "subnets",
  "securityGroups",
  "keyPairs",
  "instances",
];

app.post("/api/lookup", async (req, res) => {
  const missing = LOOKUP_REQUIRED.filter((f) => !String(req.body?.[f] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` });
  }
  if (!VALID_RESOURCES.includes(req.body.resource)) {
    return res.status(400).json({ ok: false, error: `Invalid resource. Must be one of: ${VALID_RESOURCES.join(", ")}` });
  }

  const result = await lookup({
    accessKey: req.body.accessKey.trim(),
    secretKey: req.body.secretKey.trim(),
    projectId: String(req.body.projectId || "").trim() || undefined,
    region: req.body.region.trim(),
    resource: req.body.resource,
    vpcId: String(req.body.vpcId || "").trim() || undefined,
  });

  if (!result.ok) {
    console.warn(`[LOOKUP] Failed ${req.body.resource} (${req.body.region}, projectId: ${req.body.projectId ? "yes" : "none"}): ${result.error}`);
  }

  res.status(result.ok ? 200 : 502).json(result);
});

app.post("/api/validate", (req, res) => {
  // Never echo secrets back; body is validated then stripped from logs.
  const check = validateBody(req.body);
  if (!check.ok) return res.status(400).json(check);

  const job = createJob({ mode: "validate", body: req.body });
  void executeJob(job);
  res.status(202).json(publicJob(job));
});

app.post("/api/deploy", (req, res) => {
  const check = validateBody(req.body);
  if (!check.ok) return res.status(400).json(check);

  const job = createJob({ mode: "apply", body: req.body });
  void executeJob(job);
  res.status(202).json(publicJob(job));
});

app.post("/api/windows-automation", (req, res) => {
  const { host, adminPass, repoUrl, branch, githubToken } = req.body || {};
  if (!String(host || "").trim()) {
    return res.status(400).json({ ok: false, error: "Host (Public IP) is required" });
  }
  if (!String(adminPass || "").trim()) {
    return res.status(400).json({ ok: false, error: "Administrator password is required" });
  }
  if (!String(repoUrl || "").trim()) {
    return res.status(400).json({ ok: false, error: "GitHub repository URL is required" });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const job = {
    id,
    mode: "windows-automation",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    logs: [],
    error: null,
    outputs: null,
    config: {
      host: String(host).trim(),
      repoUrl: String(repoUrl).trim(),
      branch: String(branch || "main").trim(),
      githubToken: String(githubToken || "").trim(),
    },
    _credentials: {
      adminPass: String(adminPass || ""),
    },
  };

  jobs.set(id, job);
  void executeWindowsJob(job);
  res.status(202).json(publicJob(job));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  res.json(publicJob(job));
});

app.get("/api/jobs", (_req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(publicJob);
  res.json({ jobs: list });
});

// In production, serve the built frontend from the same origin (HTTPS).
const distDir = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  // Do not log request bodies or credentials.
  console.log(`automationecs API listening on http://localhost:${PORT}`);
  console.log("Credentials are accepted over POST body only and never logged.");
});

export { stripSecrets };
