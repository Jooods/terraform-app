const API_BASE = "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function getHealth() {
  return request("/api/health");
}

export function startValidate(payload) {
  return request("/api/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startDeploy(payload) {
  return request("/api/deploy", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getJob(id) {
  return request(`/api/jobs/${id}`);
}

export function lookup({ accessKey, secretKey, projectId, region, resource, vpcId }) {
  return request("/api/lookup", {
    method: "POST",
    body: JSON.stringify({ accessKey, secretKey, projectId, region, resource, vpcId }),
  });
}

export function startWindowsAutomation(payload) {
  return request("/api/windows-automation", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createVpc(payload) {
  return request("/api/create-vpc", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createSubnet(payload) {
  return request("/api/create-subnet", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createSecurityGroup(payload) {
  return request("/api/create-security-group", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startWindowsUploadAutomation(formData) {
  const res = await fetch("/api/windows-automation-upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Upload request failed (${res.status})`);
  }
  return data;
}

