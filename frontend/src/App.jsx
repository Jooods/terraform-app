import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getHealth, getJob, startDeploy, startValidate, lookup, startWindowsAutomation, startWindowsUploadAutomation, createVpc, createSubnet, createSecurityGroup } from "./api.js";
import {
  AZ_BY_REGION,
  DISK_TYPES,
  EIP_OPTIONS,
  FLAVORS,
  REGIONS,
  SAMPLE_GUIDE,
} from "./ecsGuide.js";

const EMPTY_FORM = {
  accessKey: "",
  secretKey: "",
  projectId: "",
  region: SAMPLE_GUIDE.region,
  chargingMode: SAMPLE_GUIDE.chargingMode,
  period: SAMPLE_GUIDE.period,
  periodUnit: SAMPLE_GUIDE.periodUnit,
  autoRenew: false,
  availabilityZone: "",
  flavorId: SAMPLE_GUIDE.flavorId,
  imageId: "",
  instanceName: SAMPLE_GUIDE.instanceName,
  vpcId: "",
  subnetId: "",
  securityGroupId: "",
  systemDiskType: SAMPLE_GUIDE.systemDiskType,
  systemDiskSize: SAMPLE_GUIDE.systemDiskSize,
  dataDiskType: "",
  dataDiskSize: 0,
  loginMode: "keypair",
  keyPair: "",
  adminPass: "",
  eipType: SAMPLE_GUIDE.eipType,
  bandwidthSize: SAMPLE_GUIDE.bandwidthSize,
  bandwidthChargeMode: SAMPLE_GUIDE.bandwidthChargeMode,
};

// Resources fetched from the Huawei Cloud API
const EMPTY_RESOURCES = {
  flavors: null,
  images: null,
  azs: null,
  vpcs: null,
  subnets: null,
  securityGroups: null,
  keyPairs: null,
};

function validateClient(form) {
  const errors = {};
  const required = [
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
  for (const key of required) {
    if (!String(form[key]).trim()) errors[key] = "Required";
  }
  if (form.instanceName && form.instanceName.length > 64) {
    errors.instanceName = "Max 64 characters";
  }
  const size = Number(form.systemDiskSize);
  if (!Number.isFinite(size) || size < 40 || size > 1024) {
    errors.systemDiskSize = "Must be 40–1024 GiB";
  }
  if (form.loginMode === "keypair" && !String(form.keyPair).trim()) {
    errors.keyPair = "Select or enter a key pair name";
  }
  if (form.loginMode === "password") {
    const pass = String(form.adminPass);
    if (pass.length < 8) errors.adminPass = "Min 8 characters";
  }
  if (form.chargingMode === "prePaid") {
    const period = Number(form.period);
    if (!Number.isFinite(period) || period < 1) errors.period = "Required duration";
  }
  if (form.eipType) {
    const bw = Number(form.bandwidthSize);
    if (!Number.isFinite(bw) || bw < 1 || bw > 2000) {
      errors.bandwidthSize = "1–2000 Mbit/s";
    }
  }
  if (form.dataDiskType && Number(form.dataDiskSize) < 10) {
    errors.dataDiskSize = "Min 10 GiB when data disk type is set";
  }
  return errors;
}

function statusTone(status) {
  switch (status) {
    case "succeeded":
    case "validated":
      return "ok";
    case "failed":
      return "bad";
    case "running":
    case "queued":
      return "busy";
    default:
      return "idle";
  }
}

function azOptions(region, dynamicAZs) {
  if (dynamicAZs && dynamicAZs.length > 0) {
    return [{ id: "", label: "Random (provider default)" }, ...dynamicAZs];
  }
  return AZ_BY_REGION[region] || [{ id: "", label: "Random / leave blank" }];
}

const EMPTY_WIN_FORM = {
  accessKey: "",
  secretKey: "",
  projectId: "",
  region: "",
  instanceId: "",
  host: "",
  adminPass: "",
  sourceType: "github", // 'github' or 'file'
  repoUrl: "",
  branch: "main",
  githubToken: "",
  appZipFile: null,
};

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [health, setHealth] = useState(null);
  const pollRef = useRef(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState("provision");

  // Dynamic resources fetched from Huawei Cloud
  const [resources, setResources] = useState(EMPTY_RESOURCES);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceError, setResourceError] = useState(null);

  // Specs filters for flavors
  const [filterVcpu, setFilterVcpu] = useState("");
  const [filterRam, setFilterRam] = useState("");
  const [customSg, setCustomSg] = useState(false);

  // Windows Automation state
  const [winForm, setWinForm] = useState(EMPTY_WIN_FORM);
  const [winErrors, setWinErrors] = useState({});
  const [instances, setInstances] = useState([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [winJob, setWinJob] = useState(null);
  const [winBusy, setWinBusy] = useState(false);
  const [winBanner, setWinBanner] = useState(null);
  const winPollRef = useRef(null);

  // Network Setup tab state
  const [netBanner, setNetBanner] = useState(null);
  // VPC creation
  const [vpcForm, setVpcForm] = useState({ name: "", cidr: "192.168.0.0/16", description: "" });
  const [vpcCreating, setVpcCreating] = useState(false);
  const [createdVpc, setCreatedVpc] = useState(null);
  // Subnet creation
  const [subnetForm, setSubnetForm] = useState({ name: "", cidr: "192.168.1.0/24", gatewayIp: "192.168.1.1", dnsList: "100.125.1.250,8.8.8.8" });
  const [subnetCreating, setSubnetCreating] = useState(false);
  const [createdSubnet, setCreatedSubnet] = useState(null);
  // Security Group creation
  const [sgForm, setSgForm] = useState({ name: "", description: "" });
  const [sgCreating, setSgCreating] = useState(false);
  const [createdSg, setCreatedSg] = useState(null);

  useEffect(() => {
    return () => {
      if (winPollRef.current) clearInterval(winPollRef.current);
    };
  }, []);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() =>
        setHealth({ ok: false, terraform: { available: false, detail: "API unreachable" } })
      );
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "region") next.availabilityZone = "";
      return next;
    });
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Fetch subnets and security groups when VPC changes
  const fetchVpcResources = useCallback(
    async (vpcId) => {
      if (!form.accessKey || !form.secretKey || !form.region || !vpcId) return;
      const creds = {
        accessKey: form.accessKey.trim(),
        secretKey: form.secretKey.trim(),
        projectId: form.projectId ? form.projectId.trim() : undefined,
        region: form.region.trim(),
        vpcId,
      };
      try {
        const [subRes, sgRes] = await Promise.allSettled([
          lookup({ ...creds, resource: "subnets" }),
          lookup({ ...creds, resource: "securityGroups" }),
        ]);
        const updates = {};
        if (subRes.status === "fulfilled" && subRes.value?.ok && Array.isArray(subRes.value.items)) {
          updates.subnets = subRes.value.items;
        }
        if (sgRes.status === "fulfilled" && sgRes.value?.ok && Array.isArray(sgRes.value.items)) {
          updates.securityGroups = sgRes.value.items;
          const defaultSg = sgRes.value.items.find((sg) => sg.isDefault) || sgRes.value.items[0];
          if (defaultSg && !form.securityGroupId) {
            setField("securityGroupId", defaultSg.id);
          }
        }
        if (Object.keys(updates).length > 0) {
          setResources((prev) => ({ ...prev, ...updates }));
        }
      } catch {
        // Silently fail — user can still type IDs manually
      }
    },
    [form.accessKey, form.secretKey, form.projectId, form.region, form.securityGroupId]
  );

  // When VPC changes and resources are loaded, auto-fetch subnets & security groups
  useEffect(() => {
    if (form.vpcId && resources.vpcs) {
      fetchVpcResources(form.vpcId);
    }
  }, [form.vpcId, fetchVpcResources, resources.vpcs]);

  async function loadResources() {
    if (!form.accessKey || !form.secretKey || !form.region) {
      setBanner({ type: "error", text: "Fill in AK, SK, and Region before loading resources." });
      return;
    }

    setLoadingResources(true);
    setResourceError(null);
    setBanner(null);

    const creds = {
      accessKey: form.accessKey.trim(),
      secretKey: form.secretKey.trim(),
      projectId: form.projectId ? form.projectId.trim() : undefined,
      region: form.region.trim(),
      vpcId: form.vpcId ? form.vpcId.trim() : undefined,
    };

    const results = {};
    const allResources = ["flavors", "images", "azs", "vpcs", "securityGroups", "keyPairs"];
    const errMap = {};

    await Promise.allSettled(
      allResources.map(async (resource) => {
        try {
          const res = await lookup({ ...creds, resource });
          if (res.ok && Array.isArray(res.items)) {
            results[resource] = res.items;
          } else {
            errMap[resource] = res.error || "Failed to load";
          }
        } catch (err) {
          errMap[resource] = err.message || "Failed to load";
        }
      })
    );

    // Auto-select default security group if not chosen yet
    if (results.securityGroups && results.securityGroups.length > 0) {
      const defaultSg = results.securityGroups.find((sg) => sg.isDefault) || results.securityGroups[0];
      if (defaultSg && !form.securityGroupId) {
        setField("securityGroupId", defaultSg.id);
      }
    }

    setResources((prev) => ({ ...prev, ...results }));
    setLoadingResources(false);

    const errorCount = Object.keys(errMap).length;
    const loadedCount = Object.values(results).reduce(
      (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
      0
    );

    if (errorCount === allResources.length) {
      const firstError = Object.values(errMap)[0] || "Unknown error";
      setBanner({
        type: "error",
        text: `Failed to load resources: ${firstError}. Please check your Access Key (AK), Secret Key (SK), Region, or provide your regional Project ID.`,
      });
    } else if (errorCount > 0) {
      const details = Object.entries(errMap)
        .map(([res, msg]) => `${res}: ${msg}`)
        .join(" · ");
      setBanner({
        type: "error",
        text: `Partial load (${loadedCount} items). Failed items: ${details}. (Tip: If unauthorized or project not found, paste your regional Project ID in Credentials).`,
      });
    } else {
      setBanner({
        type: "ok",
        text: `Successfully loaded ${loadedCount} resources from Huawei Cloud (${form.region}).`,
      });
    }
  }

  function startPolling(jobId) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const next = await getJob(jobId);
        setJob(next);
        if (["succeeded", "validated", "failed"].includes(next.status)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
        }
      } catch (err) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
        setBanner({ type: "error", text: err.message });
      }
    }, 1500);
  }

  function setWinField(key, value) {
    setWinForm((prev) => ({ ...prev, [key]: value }));
    setWinErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function loadInstances() {
    const { accessKey, secretKey, projectId, region } = winForm;
    if (!accessKey || !secretKey || !region) {
      setWinBanner({ type: "error", text: "Fill in AK, SK, and Region before fetching instances." });
      return;
    }
    setLoadingInstances(true);
    setWinBanner(null);
    try {
      const res = await lookup({
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        projectId: projectId ? projectId.trim() : undefined,
        region: region.trim(),
        resource: "instances",
      });
      if (res.ok && Array.isArray(res.items)) {
        setInstances(res.items);
        setWinBanner({
          type: "ok",
          text: `Found ${res.items.length} ECS instance${res.items.length === 1 ? "" : "s"}.`,
        });
      } else {
        setWinBanner({ type: "error", text: res.error || "Failed to fetch instances." });
      }
    } catch (err) {
      setWinBanner({ type: "error", text: err.message });
    } finally {
      setLoadingInstances(false);
    }
  }

  function startWinPolling(jobId) {
    if (winPollRef.current) clearInterval(winPollRef.current);
    winPollRef.current = setInterval(async () => {
      try {
        const next = await getJob(jobId);
        setWinJob(next);
        if (["succeeded", "failed"].includes(next.status)) {
          clearInterval(winPollRef.current);
          winPollRef.current = null;
          setWinBusy(false);
        }
      } catch (err) {
        clearInterval(winPollRef.current);
        winPollRef.current = null;
        setWinBusy(false);
        setWinBanner({ type: "error", text: err.message });
      }
    }, 1500);
  }

  async function submitWindowsAutomation(e) {
    e.preventDefault();
    const errs = {};
    if (!winForm.host.trim()) errs.host = "Required";
    if (!winForm.adminPass.trim()) errs.adminPass = "Required";

    if (winForm.sourceType === "github") {
      if (!winForm.repoUrl.trim()) errs.repoUrl = "Required";
    } else if (winForm.sourceType === "file") {
      if (!winForm.appZipFile) errs.appZipFile = "Please select a .zip file";
    }

    setWinErrors(errs);
    if (Object.keys(errs).length) {
      setWinBanner({ type: "error", text: "Fix the highlighted fields before continuing." });
      return;
    }
    setWinBusy(true);
    setWinBanner(null);
    try {
      let created;
      if (winForm.sourceType === "github") {
        created = await startWindowsAutomation({
          host: winForm.host.trim(),
          adminPass: winForm.adminPass,
          repoUrl: winForm.repoUrl.trim(),
          branch: winForm.branch.trim() || "main",
          githubToken: winForm.githubToken.trim() || undefined,
        });
      } else {
        const formData = new FormData();
        formData.append("host", winForm.host.trim());
        formData.append("adminPass", winForm.adminPass);
        formData.append("appZip", winForm.appZipFile);
        created = await startWindowsUploadAutomation(formData);
      }
      setWinJob(created);
      startWinPolling(created.id);
    } catch (err) {
      setWinBusy(false);
      setWinBanner({ type: "error", text: err.message });
    }
  }

  async function submit(mode) {
    setBanner(null);
    const clientErrors = validateClient(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      setBanner({ type: "error", text: "Fix the highlighted fields before continuing." });
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ...form,
        systemDiskSize: Number(form.systemDiskSize),
        dataDiskSize: Number(form.dataDiskSize) || 0,
        period: Number(form.period) || 1,
        bandwidthSize: Number(form.bandwidthSize) || 5,
        keyPair: form.loginMode === "keypair" ? form.keyPair : "",
        adminPass: form.loginMode === "password" ? form.adminPass : "",
      };
      const created = mode === "validate" ? await startValidate(payload) : await startDeploy(payload);
      setJob(created);
      startPolling(created.id);
    } catch (err) {
      setBusy(false);
      setBanner({ type: "error", text: err.message });
    }
  }

  const tfOk = health?.terraform?.available;
  const prepaid = form.chargingMode === "prePaid";
  const needsEip = Boolean(form.eipType);
  const hasResources = Object.values(resources).some((r) => r !== null && r.length > 0);
  const canLoad = Boolean(form.accessKey && form.secretKey && form.region);

  // Build dynamic dropdown options with fallbacks
  const allFlavors = resources.flavors || FLAVORS;

  const availableVcpus = useMemo(() => {
    const set = new Set();
    for (const f of allFlavors) {
      if (f.vcpus) set.add(Number(f.vcpus));
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [allFlavors]);

  const availableRams = useMemo(() => {
    const set = new Set();
    for (const f of allFlavors) {
      if (f.ram) set.add(Number(f.ram));
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [allFlavors]);

  const filteredFlavors = useMemo(() => {
    return allFlavors.filter((f) => {
      const matchVcpu = !filterVcpu || String(f.vcpus) === String(filterVcpu);
      const matchRam = !filterRam || String(f.ram) === String(filterRam);
      return matchVcpu && matchRam;
    });
  }, [allFlavors, filterVcpu, filterRam]);

  // When filtered flavors change, ensure current flavorId is valid
  useEffect(() => {
    if (filteredFlavors.length > 0) {
      const isCurrentInFiltered = filteredFlavors.some((f) => f.id === form.flavorId);
      if (!isCurrentInFiltered) {
        setField("flavorId", filteredFlavors[0].id);
      }
    }
  }, [filteredFlavors]);

  const imageOptions = resources.images
    ? resources.images.map((img) => ({ id: img.id, label: img.label }))
    : null; // null = still use text input
  const vpcOptions = resources.vpcs
    ? resources.vpcs.map((v) => ({ id: v.id, label: v.label }))
    : null;
  const subnetOptions = resources.subnets
    ? resources.subnets.map((s) => ({ id: s.id, label: s.label }))
    : null;
  const sgOptions = resources.securityGroups
    ? resources.securityGroups.map((sg) => ({ id: sg.id, label: sg.label }))
    : null;
  const keyPairOptions = resources.keyPairs
    ? resources.keyPairs.map((kp) => ({ id: kp.name, label: kp.label }))
    : null;

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Huawei Cloud</p>
          <h1>ECS Automation</h1>
          <p className="lede">
            Provision new ECS instances via Terraform, or automate IIS deployment on existing
            Windows servers. AK/SK go to the backend only — never stored or logged.
          </p>
        </div>
        <aside className="arch" aria-label="Sample guide">
          <p className="arch-title">Sample guide</p>
          <ul>
            <li>{SAMPLE_GUIDE.regionLabel} → <code>{SAMPLE_GUIDE.region}</code></li>
            <li>Flavor <code>{SAMPLE_GUIDE.flavorId}</code></li>
            <li>Name <code>{SAMPLE_GUIDE.instanceName}</code></li>
            <li>System disk {SAMPLE_GUIDE.systemDiskSize} GiB</li>
          </ul>
          <p className="arch-note">Copy Image / VPC / Subnet / SG IDs from the console or click Load resources.</p>
        </aside>
      </header>

      <div className="status-strip" role="status">
        <span className={`pill ${tfOk ? "ok" : "bad"}`}>
          Terraform {tfOk ? `v${health.terraform.version}` : "unavailable"}
        </span>
        {hasResources && (
          <span className="pill ok">Resources loaded</span>
        )}
        <span className="hint">
          SK &amp; password stay in memory only · never local storage, URLs, or logs
        </span>
      </div>

      {/* Tab Navigation */}
      <div className="nav-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "provision"}
          className={`nav-tab ${activeTab === "provision" ? "active" : ""}`}
          onClick={() => setActiveTab("provision")}
        >
          🖥️ Provision ECS
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "network"}
          className={`nav-tab ${activeTab === "network" ? "active" : ""}`}
          onClick={() => setActiveTab("network")}
        >
          🔒 Network Setup
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "windows"}
          className={`nav-tab ${activeTab === "windows" ? "active" : ""}`}
          onClick={() => setActiveTab("windows")}
        >
          🪟 Windows Automation
        </button>
      </div>

      {/* Provision Tab banners */}
      {activeTab === "provision" && banner && (
        <div className={`banner ${banner.type}`} role="alert">
          {banner.text}
        </div>
      )}

      {/* Network Tab banners */}
      {activeTab === "network" && netBanner && (
        <div className={`banner ${netBanner.type}`} role="alert">
          {netBanner.text}
        </div>
      )}

      {/* Windows Tab banners */}
      {activeTab === "windows" && winBanner && (
        <div className={`banner ${winBanner.type}`} role="alert">
          {winBanner.text}
        </div>
      )}

      <div className="layout" style={{ display: activeTab === "provision" ? undefined : "none" }}>
        <form
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault();
            submit("apply");
          }}
        >
          <section>
            <h2>Credentials</h2>
            <p className="section-help">
              IAM AK/SK must allow creating ECS, VPC, disks, and EIP. If your IAM user cannot list projects automatically, paste your regional <strong>Project ID</strong> (Console → Top-right user menu → My Credentials → API Credentials → Projects).
            </p>
            <div className="grid two">
              <Field label="Access Key (AK)" name="accessKey" value={form.accessKey} error={errors.accessKey} onChange={setField} />
              <Field label="Secret Key (SK)" name="secretKey" value={form.secretKey} error={errors.secretKey} type="password" autoComplete="new-password" onChange={setField} />
              <Field label="Project ID" name="projectId" value={form.projectId} error={errors.projectId} placeholder="Recommended: paste your regional project ID" onChange={setField} />
            </div>
          </section>

          <section>
            <h2>Basic configuration</h2>
            <p className="section-help">
              Region cannot change after create. Resources in different regions cannot talk over intranet.
            </p>
            <div className="grid two">
              <Select
                label="Billing mode"
                name="chargingMode"
                value={form.chargingMode}
                error={errors.chargingMode}
                onChange={setField}
                options={[
                  { id: "prePaid", label: "Yearly/Monthly (prePaid)" },
                  { id: "postPaid", label: "Pay-per-use (postPaid)" },
                ]}
              />
              <Select
                label="Region"
                name="region"
                value={form.region}
                error={errors.region}
                onChange={setField}
                options={REGIONS}
              />
            </div>

            {/* Load Resources button */}
            <div className="load-resources-row">
              <button
                type="button"
                className="btn load-btn"
                disabled={!canLoad || loadingResources}
                onClick={loadResources}
              >
                {loadingResources ? (
                  <>
                    <span className="spinner" /> Loading…
                  </>
                ) : hasResources ? (
                  "↻ Reload resources"
                ) : (
                  "⬇ Load resources from Huawei Cloud"
                )}
              </button>
              {!canLoad && (
                <span className="hint">Fill AK, SK &amp; Region first</span>
              )}
            </div>

            <div className="grid two">
              <Select
                label="AZ"
                name="availabilityZone"
                value={form.availabilityZone}
                error={errors.availabilityZone}
                onChange={setField}
                options={azOptions(form.region, resources.azs)}
              />
              <Field
                label="ECS name"
                name="instanceName"
                value={form.instanceName}
                error={errors.instanceName}
                placeholder="ecs-7b78"
                onChange={setField}
              />
              {prepaid && (
                <>
                  <Select
                    label="Required duration unit"
                    name="periodUnit"
                    value={form.periodUnit}
                    onChange={setField}
                    options={[
                      { id: "month", label: "Month(s)" },
                      { id: "year", label: "Year(s)" },
                    ]}
                  />
                  <Field
                    label="Required duration"
                    name="period"
                    value={form.period}
                    error={errors.period}
                    type="number"
                    min={1}
                    max={form.periodUnit === "year" ? 3 : 9}
                    onChange={setField}
                  />
                  <label className="field check">
                    <span>Auto-renew</span>
                    <input
                      type="checkbox"
                      checked={form.autoRenew}
                      onChange={(e) => setField("autoRenew", e.target.checked)}
                    />
                  </label>
                </>
              )}
            </div>
          </section>

          <section>
            <h2>Instance specifications</h2>
            <p className="section-help">
              Input your desired vCPU and Memory (RAM) to filter matching flavors, or choose from the full list.
            </p>

            <div className="specs-filter-box">
              <div className="specs-filter-title">
                <span>Filter Flavors by Specs</span>
                {(filterVcpu || filterRam) && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setFilterVcpu("");
                      setFilterRam("");
                    }}
                  >
                    Clear filter (show all)
                  </button>
                )}
              </div>
              <div className="grid two">
                <Select
                  label="Target vCPU"
                  name="filterVcpu"
                  value={filterVcpu}
                  onChange={(_, val) => setFilterVcpu(val)}
                  options={[
                    { id: "", label: "All vCPUs" },
                    ...availableVcpus.map((v) => ({ id: String(v), label: `${v} vCPU` })),
                  ]}
                />
                <Select
                  label="Target Memory (RAM)"
                  name="filterRam"
                  value={filterRam}
                  onChange={(_, val) => setFilterRam(val)}
                  options={[
                    { id: "", label: "All Memory sizes" },
                    ...availableRams.map((r) => ({ id: String(r), label: `${r} GiB` })),
                  ]}
                />
              </div>
              <div className="specs-filter-status">
                {filteredFlavors.length > 0 ? (
                  <span className="hint-match">
                    ✓ Found <strong>{filteredFlavors.length}</strong> matching flavor{filteredFlavors.length === 1 ? "" : "s"}
                    {(filterVcpu || filterRam) && (
                      <> for {filterVcpu ? `${filterVcpu} vCPU` : ""}{filterVcpu && filterRam ? " / " : ""}{filterRam ? `${filterRam} GiB RAM` : ""}</>
                    )}
                  </span>
                ) : (
                  <span className="hint-nomatch">
                    ⚠ No exact flavor matches {filterVcpu ? `${filterVcpu} vCPU` : ""}{filterVcpu && filterRam ? " and " : ""}{filterRam ? `${filterRam} GiB RAM` : ""}. Try selecting different specs or clear filter.
                  </span>
                )}
              </div>
            </div>

            <div className="grid two">
              <Select
                label="Flavor (Specification)"
                name="flavorId"
                value={form.flavorId}
                error={errors.flavorId}
                onChange={setField}
                options={
                  filteredFlavors.length > 0
                    ? filteredFlavors
                    : [{ id: "", label: "No flavors match filter — clear filter above" }]
                }
              />
              {imageOptions ? (
                <Select
                  label="Image"
                  name="imageId"
                  value={form.imageId}
                  error={errors.imageId}
                  onChange={setField}
                  options={[{ id: "", label: "Select an image…" }, ...imageOptions]}
                />
              ) : (
                <Field
                  label="Image ID (public / private / shared)"
                  name="imageId"
                  value={form.imageId}
                  error={errors.imageId}
                  placeholder="Paste image UUID or load resources above"
                  onChange={setField}
                />
              )}
            </div>
          </section>

          <section>
            <h2>Storage</h2>
            <div className="grid two">
              <Select
                label="System disk type"
                name="systemDiskType"
                value={form.systemDiskType}
                onChange={setField}
                options={DISK_TYPES}
              />
              <Field
                label="System disk (GiB)"
                name="systemDiskSize"
                value={form.systemDiskSize}
                error={errors.systemDiskSize}
                type="number"
                min={40}
                max={1024}
                onChange={setField}
              />
              <Select
                label="Data disk type (optional)"
                name="dataDiskType"
                value={form.dataDiskType}
                onChange={setField}
                options={[{ id: "", label: "None" }, ...DISK_TYPES]}
              />
              <Field
                label="Data disk (GiB)"
                name="dataDiskSize"
                value={form.dataDiskSize}
                error={errors.dataDiskSize}
                type="number"
                min={0}
                max={32768}
                onChange={setField}
              />
            </div>
          </section>

          <section>
            <h2>Network</h2>
            <p className="section-help">
              Use an existing VPC, primary NIC subnet, and security group. Prefer trusted sources over 0.0.0.0/0 for ports 22 / 3389.
            </p>
            <div className="grid two">
              {vpcOptions ? (
                <Select
                  label="VPC"
                  name="vpcId"
                  value={form.vpcId}
                  error={errors.vpcId}
                  onChange={setField}
                  options={[{ id: "", label: "Select a VPC…" }, ...vpcOptions]}
                />
              ) : (
                <Field label="VPC ID" name="vpcId" value={form.vpcId} error={errors.vpcId} onChange={setField} />
              )}
              {subnetOptions ? (
                <Select
                  label="Primary NIC — Subnet"
                  name="subnetId"
                  value={form.subnetId}
                  error={errors.subnetId}
                  onChange={setField}
                  options={[{ id: "", label: "Select a subnet…" }, ...subnetOptions]}
                />
              ) : (
                <Field label="Primary NIC — Subnet ID" name="subnetId" value={form.subnetId} error={errors.subnetId} onChange={setField} />
              )}
              {sgOptions && !customSg ? (
                <div>
                  <Select
                    label="Security group"
                    name="securityGroupId"
                    value={form.securityGroupId}
                    error={errors.securityGroupId}
                    onChange={setField}
                    options={[{ id: "", label: "Select a security group…" }, ...sgOptions]}
                  />
                  <button
                    type="button"
                    className="btn-link toggle-link"
                    onClick={() => setCustomSg(true)}
                  >
                    Enter custom security group ID instead
                  </button>
                </div>
              ) : (
                <div>
                  <Field
                    label="Security group ID"
                    name="securityGroupId"
                    value={form.securityGroupId}
                    error={errors.securityGroupId}
                    placeholder="Paste SG UUID or load resources above"
                    onChange={setField}
                  />
                  {sgOptions && (
                    <button
                      type="button"
                      className="btn-link toggle-link"
                      onClick={() => setCustomSg(false)}
                    >
                      ← Back to fetched security groups list
                    </button>
                  )}
                </div>
              )}
              <Select
                label="Public network — EIP"
                name="eipType"
                value={form.eipType}
                onChange={setField}
                options={EIP_OPTIONS}
              />
              {needsEip && (
                <>
                  <Select
                    label="Billed by"
                    name="bandwidthChargeMode"
                    value={form.bandwidthChargeMode}
                    onChange={setField}
                    options={[
                      { id: "bandwidth", label: "Bandwidth (heavy/stable traffic)" },
                      { id: "traffic", label: "Traffic (light/fluctuating)" },
                    ]}
                  />
                  <Field
                    label="Bandwidth size (Mbit/s)"
                    name="bandwidthSize"
                    value={form.bandwidthSize}
                    error={errors.bandwidthSize}
                    type="number"
                    min={1}
                    max={2000}
                    onChange={setField}
                  />
                </>
              )}
            </div>
          </section>

          <section>
            <h2>Instance management — login</h2>
            <div className="grid two">
              <Select
                label="Login mode"
                name="loginMode"
                value={form.loginMode}
                onChange={setField}
                options={[
                  { id: "keypair", label: "Key pair" },
                  { id: "password", label: "Password" },
                ]}
              />
              {form.loginMode === "keypair" ? (
                keyPairOptions ? (
                  <Select
                    label="Key pair"
                    name="keyPair"
                    value={form.keyPair}
                    error={errors.keyPair}
                    onChange={setField}
                    options={[{ id: "", label: "Select a key pair…" }, ...keyPairOptions]}
                  />
                ) : (
                  <Field
                    label="Key pair name"
                    name="keyPair"
                    value={form.keyPair}
                    error={errors.keyPair}
                    placeholder="Existing key pair in this region"
                    onChange={setField}
                  />
                )
              ) : (
                <Field
                  label="Password"
                  name="adminPass"
                  value={form.adminPass}
                  error={errors.adminPass}
                  type="password"
                  autoComplete="new-password"
                  onChange={setField}
                />
              )}
            </div>
          </section>

          <div className="actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => submit("validate")}>
              Validate &amp; plan
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Working…" : "Deploy ECS"}
            </button>
          </div>
        </form>

        <aside className="panel status-panel">
          <h2>Deployment status</h2>
          <div className="guide-box">
            <p className="guide-title">Still need from console</p>
            <ul>
              {SAMPLE_GUIDE.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          {!job ? (
            <p className="empty">No job yet. Validate or deploy to see progress here.</p>
          ) : (
            <>
              <div className="job-meta">
                <span className={`pill ${statusTone(job.status)}`}>{job.status}</span>
                <span className="mono muted">{job.mode}</span>
                <span className="mono muted truncate" title={job.id}>
                  {job.id}
                </span>
              </div>

              {job.error && <div className="banner error compact">{job.error}</div>}

              {job.outputs && (
                <dl className="outputs">
                  {Object.entries(job.outputs).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="mono">{v == null ? "—" : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="log" aria-live="polite">
                {(job.logs || []).map((line, i) => (
                  <div key={`${line.ts}-${i}`} className={`log-line ${line.level}`}>
                    <time>{new Date(line.ts).toLocaleTimeString()}</time>
                    <pre>{line.message}</pre>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── Windows Automation Tab ───────────────────────────── */}
      {activeTab === "windows" && (
        <div className="win-panel">

          {/* Step 1: Credentials */}
          <div className="win-section">
            <h3>1 · Huawei Cloud Credentials</h3>
            <p className="section-help">
              Enter your AK/SK and region, then fetch your existing ECS instances.
            </p>
            <div className="grid two">
              <Field label="Access Key (AK)" name="accessKey" value={winForm.accessKey} error={winErrors.accessKey} onChange={setWinField} />
              <Field label="Secret Key (SK)" name="secretKey" value={winForm.secretKey} error={winErrors.secretKey} type="password" autoComplete="new-password" onChange={setWinField} />
              <Field label="Project ID (recommended)" name="projectId" value={winForm.projectId} onChange={setWinField} placeholder="Paste your regional project ID" />
              <Select
                label="Region"
                name="region"
                value={winForm.region}
                onChange={setWinField}
                options={[{ id: "", label: "Select region…" }, ...REGIONS]}
              />
            </div>
            <div className="load-resources-row">
              <button
                type="button"
                className="btn load-btn"
                disabled={!winForm.accessKey || !winForm.secretKey || !winForm.region || loadingInstances}
                onClick={loadInstances}
              >
                {loadingInstances ? (
                  <><span className="spinner" /> Fetching instances…</>
                ) : (
                  "⬇ Fetch Existing ECS Instances"
                )}
              </button>
            </div>
          </div>

          {/* Step 2: Select Instance */}
          {instances.length > 0 && (
            <div className="win-section">
              <h3>2 · Select Windows ECS Instance</h3>
              <p className="section-help">
                Click a Windows instance to select it. The public IP will be auto-filled below.
              </p>
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  className={`instance-card ${winForm.instanceId === inst.id ? "selected" : ""}`}
                  onClick={() => {
                    setWinField("instanceId", inst.id);
                    // Auto-fill host with public IP if available
                    const publicIp = inst.publicIp || "";
                    if (publicIp) setWinField("host", publicIp);
                  }}
                >
                  <div className="instance-card-info">
                    <div className="instance-card-name">{inst.name || inst.id}</div>
                    <div className="instance-card-meta">
                      {inst.flavorId} · Status: {inst.status}
                      {inst.publicIp && ` · Public IP: ${inst.publicIp}`}
                      {inst.privateIp && ` · Private IP: ${inst.privateIp}`}
                    </div>
                  </div>
                  <span className="instance-os-badge">{inst.osType || "Windows"}</span>
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Deploy Form */}
          <form className="win-section" onSubmit={submitWindowsAutomation}>
            <h3>3 · IIS Deployment Configuration</h3>
            <p className="section-help">
              Enter the Windows server public IP and Administrator password, choose your application source (GitHub repository or direct file upload), and launch automation.
            </p>

            <div className="grid two">
              <Field
                label="Windows Server Public IP"
                name="host"
                value={winForm.host}
                error={winErrors.host}
                placeholder="e.g. 121.36.x.x"
                onChange={setWinField}
              />
              <Field
                label="Administrator Password"
                name="adminPass"
                value={winForm.adminPass}
                error={winErrors.adminPass}
                type="password"
                autoComplete="new-password"
                onChange={setWinField}
              />
            </div>

            {/* Application Source Selection */}
            <div style={{ margin: "1.2rem 0" }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: "0.6rem" }}>
                Application Source
              </label>
              <div style={{ display: "flex", gap: "1rem" }}>
                <label
                  style={{
                    flex: 1,
                    padding: "0.8rem 1rem",
                    borderRadius: "8px",
                    border: `2px solid ${winForm.sourceType === "github" ? "var(--accent)" : "var(--border)"}`,
                    background: winForm.sourceType === "github" ? "rgba(99, 102, 241, 0.08)" : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    transition: "all 0.2s ease"
                  }}
                >
                  <input
                    type="radio"
                    name="sourceType"
                    value="github"
                    checked={winForm.sourceType === "github"}
                    onChange={(e) => setWinField("sourceType", e.target.value)}
                  />
                  <span>📦 GitHub Repository</span>
                </label>
                <label
                  style={{
                    flex: 1,
                    padding: "0.8rem 1rem",
                    borderRadius: "8px",
                    border: `2px solid ${winForm.sourceType === "file" ? "var(--accent)" : "var(--border)"}`,
                    background: winForm.sourceType === "file" ? "rgba(99, 102, 241, 0.08)" : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    transition: "all 0.2s ease"
                  }}
                >
                  <input
                    type="radio"
                    name="sourceType"
                    value="file"
                    checked={winForm.sourceType === "file"}
                    onChange={(e) => setWinField("sourceType", e.target.value)}
                  />
                  <span>📁 Upload Zip Folder</span>
                </label>
              </div>
            </div>

            {winForm.sourceType === "github" ? (
              <div className="grid two">
                <Field
                  label="GitHub Repository URL"
                  name="repoUrl"
                  value={winForm.repoUrl}
                  error={winErrors.repoUrl}
                  placeholder="https://github.com/owner/repo  or  owner/repo"
                  onChange={setWinField}
                />
                <Field
                  label="Branch (default: main)"
                  name="branch"
                  value={winForm.branch}
                  onChange={setWinField}
                  placeholder="main"
                />
                <Field
                  label="GitHub Token (for private repos)"
                  name="githubToken"
                  value={winForm.githubToken}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Optional — leave blank for public repos"
                  onChange={setWinField}
                />
              </div>
            ) : (
              <div style={{ background: "var(--surface-hover)", padding: "1.2rem", borderRadius: "8px", marginTop: "1rem" }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>
                  Upload Static Web App (.zip)
                </label>
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.8rem" }}>
                  Zip your static web application folder (containing <code>index.html</code>, <code>css/</code>, <code>js/</code>, etc.). It will be unzipped and deployed directly to IIS <code>C:\inetpub\wwwroot</code>.
                </p>
                <input
                  type="file"
                  accept=".zip"
                  style={{ display: "block", width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setWinField("appZipFile", file);
                  }}
                />
                {winErrors.appZipFile && (
                  <span style={{ color: "var(--error)", fontSize: "0.85rem", marginTop: "0.4rem", display: "block" }}>
                    {winErrors.appZipFile}
                  </span>
                )}
                {winForm.appZipFile && (
                  <div style={{ fontSize: "0.85rem", color: "var(--accent)", marginTop: "0.5rem" }}>
                    Selected: <strong>{winForm.appZipFile.name}</strong> ({(winForm.appZipFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
              </div>
            )}

            <div className="actions">
              <button type="submit" className="btn primary" disabled={winBusy}>
                {winBusy ? <><span className="spinner" /> Running automation…</> : "🚀 Deploy to Windows ECS"}
              </button>
            </div>
          </form>

          {/* Step 4: Job Status */}
          {winJob && (
            <div className="win-section">
              <h3>4 · Automation Status</h3>
              <div className="job-meta">
                <span className={`pill ${statusTone(winJob.status)}`}>{winJob.status}</span>
                <span className="mono muted">{winJob.mode}</span>
                <span className="mono muted truncate" title={winJob.id}>{winJob.id}</span>
              </div>

              {winJob.error && (
                <div className="banner error compact">{winJob.error}</div>
              )}

              {/* Show live website URL only on success */}
              {winJob.status === "succeeded" && winJob.outputs?.websiteUrl && (
                <div className="success-link-card">
                  <span className="link-icon">🌐</span>
                  <div>
                    <div><a href={winJob.outputs.websiteUrl} target="_blank" rel="noreferrer">{winJob.outputs.websiteUrl}</a></div>
                    <div className="success-link-label">Your IIS website is live at this address</div>
                  </div>
                </div>
              )}

              {/* 1-click fallback PowerShell script */}
              {winJob.outputs?.script && (
                <div className="script-box">
                  <div className="script-header">
                    <span>📋 1-Click PowerShell Script — run this on the Windows server if WinRM is blocked</span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        navigator.clipboard.writeText(winJob.outputs.script).catch(() => {});
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <pre>{winJob.outputs.script}</pre>
                </div>
              )}

              {winJob.outputs && (
                <dl className="outputs">
                  {Object.entries(winJob.outputs)
                    .filter(([k]) => k !== "script")
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd className="mono">{v == null ? "—" : String(v)}</dd>
                      </div>
                    ))}
                </dl>
              )}

              <div className="log" aria-live="polite">
                {(winJob.logs || []).map((line, i) => (
                  <div key={`${line.ts}-${i}`} className={`log-line ${line.level}`}>
                    <time>{new Date(line.ts).toLocaleTimeString()}</time>
                    <pre>{line.message}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Network Setup Tab ── */}
      {activeTab === "network" && (
        <div className="layout" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Shared credentials notice */}
          <div className="panel" style={{ padding: "1.1rem 1.4rem" }}>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.55 }}>
              <strong style={{ color: "var(--accent)" }}>ℹ️ Shared credentials</strong> — this tab uses the
              <strong> AK, SK, Project ID, and Region</strong> from the
              <button
                type="button"
                className="btn-link"
                style={{ margin: "0 0.3em" }}
                onClick={() => setActiveTab("provision")}
              >Provision ECS</button>
              tab. Fill those in first.
              {form.region ? (
                <span> Current region: <code style={{ color: "var(--accent)" }}>{form.region}</code></span>
              ) : (
                <span style={{ color: "var(--warn)" }}> ⚠️ Region not set yet.</span>
              )}
            </p>
          </div>

          {/* ── Step 1: Create VPC ── */}
          <div className="panel form">
            <section>
              <h2>Step 1 — Create VPC</h2>
              <p className="section-help">
                A Virtual Private Cloud (VPC) is the isolated network that all your ECS instances live inside.
                Pick a CIDR that doesn't overlap with other networks you need to peer with.
              </p>
              {createdVpc ? (
                <div className="net-result-card">
                  <span className="pill ok">✓ VPC created</span>
                  <dl className="outputs" style={{ marginTop: "0.75rem" }}>
                    <div><dt>Name</dt><dd className="mono">{createdVpc.name}</dd></div>
                    <div><dt>ID</dt><dd className="mono">{createdVpc.id}</dd></div>
                    <div><dt>CIDR</dt><dd className="mono">{createdVpc.cidr}</dd></div>
                    <div><dt>Status</dt><dd className="mono">{createdVpc.status}</dd></div>
                  </dl>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.85rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setField("vpcId", createdVpc.id);
                        setNetBanner({ type: "ok", text: `VPC ID "${createdVpc.id}" auto-filled in the Provision ECS form.` });
                      }}
                    >
                      ⬆ Auto-fill VPC ID in ECS form
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "var(--bg2)", color: "var(--muted)" }}
                      onClick={() => setCreatedVpc(null)}
                    >
                      Create another VPC
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!form.accessKey || !form.secretKey || !form.region) {
                      setNetBanner({ type: "error", text: "Fill in AK, SK, and Region in the Provision ECS tab first." });
                      return;
                    }
                    setVpcCreating(true);
                    setNetBanner(null);
                    try {
                      const res = await createVpc({
                        accessKey: form.accessKey.trim(),
                        secretKey: form.secretKey.trim(),
                        projectId: form.projectId || undefined,
                        region: form.region.trim(),
                        name: vpcForm.name.trim(),
                        cidr: vpcForm.cidr.trim(),
                        description: vpcForm.description.trim() || undefined,
                      });
                      setCreatedVpc(res.vpc);
                      setNetBanner({ type: "ok", text: `VPC "${res.vpc.name}" created successfully (ID: ${res.vpc.id}).` });
                    } catch (err) {
                      setNetBanner({ type: "error", text: `Failed to create VPC: ${err.message}` });
                    } finally {
                      setVpcCreating(false);
                    }
                  }}
                >
                  <div className="grid two">
                    <Field
                      label="VPC Name"
                      name="vpcName"
                      value={vpcForm.name}
                      placeholder="e.g. my-vpc"
                      onChange={(_, v) => setVpcForm((p) => ({ ...p, name: v }))}
                    />
                    <Field
                      label="CIDR Block"
                      name="vpcCidr"
                      value={vpcForm.cidr}
                      placeholder="e.g. 192.168.0.0/16"
                      onChange={(_, v) => setVpcForm((p) => ({ ...p, cidr: v }))}
                    />
                    <Field
                      label="Description (optional)"
                      name="vpcDescription"
                      value={vpcForm.description}
                      placeholder="e.g. Production VPC"
                      onChange={(_, v) => setVpcForm((p) => ({ ...p, description: v }))}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn primary" disabled={vpcCreating || !vpcForm.name.trim() || !vpcForm.cidr.trim()}>
                      {vpcCreating ? <><span className="spinner" /> Creating…</> : "Create VPC"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          {/* ── Step 2: Create Subnet ── */}
          <div className="panel form">
            <section>
              <h2>Step 2 — Create Subnet</h2>
              <p className="section-help">
                A Subnet carves up your VPC CIDR. Every ECS instance is launched into a subnet.
                You need the VPC ID from Step 1 (or an existing one).
              </p>
              {createdSubnet ? (
                <div className="net-result-card">
                  <span className="pill ok">✓ Subnet created</span>
                  <dl className="outputs" style={{ marginTop: "0.75rem" }}>
                    <div><dt>Name</dt><dd className="mono">{createdSubnet.name}</dd></div>
                    <div><dt>ID</dt><dd className="mono">{createdSubnet.id}</dd></div>
                    <div><dt>CIDR</dt><dd className="mono">{createdSubnet.cidr}</dd></div>
                    <div><dt>Gateway</dt><dd className="mono">{createdSubnet.gatewayIp}</dd></div>
                    <div><dt>Status</dt><dd className="mono">{createdSubnet.status}</dd></div>
                  </dl>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.85rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setField("subnetId", createdSubnet.id);
                        setNetBanner({ type: "ok", text: `Subnet ID "${createdSubnet.id}" auto-filled in the Provision ECS form.` });
                      }}
                    >
                      ⬆ Auto-fill Subnet ID in ECS form
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "var(--bg2)", color: "var(--muted)" }}
                      onClick={() => setCreatedSubnet(null)}
                    >
                      Create another Subnet
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!form.accessKey || !form.secretKey || !form.region) {
                      setNetBanner({ type: "error", text: "Fill in AK, SK, and Region in the Provision ECS tab first." });
                      return;
                    }
                    if (!subnetForm.vpcId.trim()) {
                      setNetBanner({ type: "error", text: "VPC ID is required. Create a VPC in Step 1 or paste an existing ID." });
                      return;
                    }
                    setSubnetCreating(true);
                    setNetBanner(null);
                    try {
                      const dnsList = subnetForm.dnsList
                        ? subnetForm.dnsList.split(",").map((s) => s.trim()).filter(Boolean)
                        : undefined;
                      const res = await createSubnet({
                        accessKey: form.accessKey.trim(),
                        secretKey: form.secretKey.trim(),
                        projectId: form.projectId || undefined,
                        region: form.region.trim(),
                        name: subnetForm.name.trim(),
                        cidr: subnetForm.cidr.trim(),
                        vpcId: subnetForm.vpcId.trim(),
                        gatewayIp: subnetForm.gatewayIp.trim() || undefined,
                        dnsList,
                      });
                      setCreatedSubnet(res.subnet);
                      setNetBanner({ type: "ok", text: `Subnet "${res.subnet.name}" created successfully (ID: ${res.subnet.id}).` });
                    } catch (err) {
                      setNetBanner({ type: "error", text: `Failed to create Subnet: ${err.message}` });
                    } finally {
                      setSubnetCreating(false);
                    }
                  }}
                >
                  <div className="grid two">
                    <Field
                      label="Subnet Name"
                      name="subnetName"
                      value={subnetForm.name}
                      placeholder="e.g. my-subnet"
                      onChange={(_, v) => setSubnetForm((p) => ({ ...p, name: v }))}
                    />
                    <Field
                      label="Subnet CIDR"
                      name="subnetCidr"
                      value={subnetForm.cidr}
                      placeholder="e.g. 192.168.1.0/24"
                      onChange={(_, v) => setSubnetForm((p) => ({ ...p, cidr: v }))}
                    />
                    <Field
                      label="VPC ID"
                      name="subnetVpcId"
                      value={subnetForm.vpcId || (createdVpc ? createdVpc.id : "")}
                      placeholder={createdVpc ? createdVpc.id : "Paste VPC ID or create in Step 1"}
                      onChange={(_, v) => setSubnetForm((p) => ({ ...p, vpcId: v }))}
                    />
                    <Field
                      label="Gateway IP"
                      name="subnetGw"
                      value={subnetForm.gatewayIp}
                      placeholder="e.g. 192.168.1.1"
                      onChange={(_, v) => setSubnetForm((p) => ({ ...p, gatewayIp: v }))}
                    />
                    <Field
                      label="DNS Servers (comma-separated)"
                      name="subnetDns"
                      value={subnetForm.dnsList}
                      placeholder="100.125.1.250,8.8.8.8"
                      onChange={(_, v) => setSubnetForm((p) => ({ ...p, dnsList: v }))}
                    />
                  </div>
                  {createdVpc && !subnetForm.vpcId && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}
                        onClick={() => setSubnetForm((p) => ({ ...p, vpcId: createdVpc.id }))}
                      >
                        ← Use VPC from Step 1 ({createdVpc.id.slice(0, 12)}…)
                      </button>
                    </div>
                  )}
                  <div className="form-actions">
                    <button type="submit" className="btn primary" disabled={subnetCreating || !subnetForm.name.trim() || !subnetForm.cidr.trim()}>
                      {subnetCreating ? <><span className="spinner" /> Creating…</> : "Create Subnet"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          {/* ── Step 3: Create Security Group ── */}
          <div className="panel form">
            <section>
              <h2>Step 3 — Create Security Group</h2>
              <p className="section-help">
                A Security Group acts as a virtual firewall for your ECS instances, controlling inbound and
                outbound traffic. Default rules will be created automatically — you can refine them in the
                Huawei Cloud Console afterwards.
              </p>
              {createdSg ? (
                <div className="net-result-card">
                  <span className="pill ok">✓ Security Group created</span>
                  <dl className="outputs" style={{ marginTop: "0.75rem" }}>
                    <div><dt>Name</dt><dd className="mono">{createdSg.name}</dd></div>
                    <div><dt>ID</dt><dd className="mono">{createdSg.id}</dd></div>
                    {createdSg.description && <div><dt>Description</dt><dd className="mono">{createdSg.description}</dd></div>}
                  </dl>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.85rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setField("securityGroupId", createdSg.id);
                        setNetBanner({ type: "ok", text: `Security Group ID "${createdSg.id}" auto-filled in the Provision ECS form.` });
                      }}
                    >
                      ⬆ Auto-fill Security Group ID in ECS form
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "var(--bg2)", color: "var(--muted)" }}
                      onClick={() => setCreatedSg(null)}
                    >
                      Create another Security Group
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!form.accessKey || !form.secretKey || !form.region) {
                      setNetBanner({ type: "error", text: "Fill in AK, SK, and Region in the Provision ECS tab first." });
                      return;
                    }
                    setSgCreating(true);
                    setNetBanner(null);
                    try {
                      const res = await createSecurityGroup({
                        accessKey: form.accessKey.trim(),
                        secretKey: form.secretKey.trim(),
                        projectId: form.projectId || undefined,
                        region: form.region.trim(),
                        name: sgForm.name.trim(),
                        description: sgForm.description.trim() || undefined,
                      });
                      setCreatedSg(res.securityGroup);
                      setNetBanner({ type: "ok", text: `Security Group "${res.securityGroup.name}" created successfully (ID: ${res.securityGroup.id}).` });
                    } catch (err) {
                      setNetBanner({ type: "error", text: `Failed to create Security Group: ${err.message}` });
                    } finally {
                      setSgCreating(false);
                    }
                  }}
                >
                  <div className="grid two">
                    <Field
                      label="Security Group Name"
                      name="sgName"
                      value={sgForm.name}
                      placeholder="e.g. my-web-sg"
                      onChange={(_, v) => setSgForm((p) => ({ ...p, name: v }))}
                    />
                    <Field
                      label="Description (optional)"
                      name="sgDescription"
                      value={sgForm.description}
                      placeholder="e.g. Allow HTTP and RDP"
                      onChange={(_, v) => setSgForm((p) => ({ ...p, description: v }))}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn primary" disabled={sgCreating || !sgForm.name.trim()}>
                      {sgCreating ? <><span className="spinner" /> Creating…</> : "Create Security Group"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          {/* ── Summary & Go to ECS Provision ── */}
          {(createdVpc || createdSubnet || createdSg) && (
            <div className="panel" style={{ padding: "1.2rem 1.4rem" }}>
              <h2 style={{ marginTop: 0, marginBottom: "0.75rem" }}>📋 Summary — Created Resources</h2>
              <dl className="outputs">
                {createdVpc && <div><dt>VPC ID</dt><dd className="mono">{createdVpc.id}</dd></div>}
                {createdSubnet && <div><dt>Subnet ID</dt><dd className="mono">{createdSubnet.id}</dd></div>}
                {createdSg && <div><dt>Security Group ID</dt><dd className="mono">{createdSg.id}</dd></div>}
              </dl>
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    if (createdVpc) setField("vpcId", createdVpc.id);
                    if (createdSubnet) setField("subnetId", createdSubnet.id);
                    if (createdSg) setField("securityGroupId", createdSg.id);
                    setActiveTab("provision");
                    setBanner({ type: "ok", text: "Network IDs auto-filled from Network Setup. Ready to provision!" });
                  }}
                >
                  ✅ Auto-fill all IDs &amp; go to Provision ECS
                </button>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}

function Field({
  label,
  name,
  value,
  error,
  onChange,
  type = "text",
  autoComplete = "off",
  min,
  max,
  placeholder,
}) {
  return (
    <label className={`field ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        min={min}
        max={max}
        onChange={(e) => onChange(name, type === "number" ? e.target.value : e.target.value)}
      />
      {error && <em>{error}</em>}
    </label>
  );
}

function Select({ label, name, value, error, onChange, options }) {
  return (
    <label className={`field ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      <select name={name} value={value} onChange={(e) => onChange(name, e.target.value)}>
        {options.map((opt) => (
          <option key={opt.id || opt.label} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <em>{error}</em>}
    </label>
  );
}
