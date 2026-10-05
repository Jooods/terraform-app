/**
 * huaweiLookup.js — Short-lived SDK clients for fetching Huawei Cloud resources.
 *
 * Every function creates a client from the caller's credentials, calls the API,
 * maps the response to a simple shape, and returns it. Credentials are never stored.
 */

import { BasicCredentials } from "@huaweicloud/huaweicloud-sdk-core/auth/BasicCredentials.js";
import * as EcsSdk from "@huaweicloud/huaweicloud-sdk-ecs";
import * as VpcSdk from "@huaweicloud/huaweicloud-sdk-vpc";
import * as ImsSdk from "@huaweicloud/huaweicloud-sdk-ims";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ecsEndpoint(region) {
  return `https://ecs.${region}.myhuaweicloud.com`;
}

function vpcEndpoint(region) {
  return `https://vpc.${region}.myhuaweicloud.com`;
}

function imsEndpoint(region) {
  return `https://ims.${region}.myhuaweicloud.com`;
}

function getIamEndpoint(region) {
  if (!region) return "https://iam.myhuaweicloud.com";
  if (
    region.startsWith("ap-") ||
    region.startsWith("af-") ||
    region.startsWith("la-") ||
    region.startsWith("sa-") ||
    region.startsWith("na-") ||
    region.startsWith("ru-")
  ) {
    return `https://iam.${region}.myhuaweicloud.com`;
  }
  return "https://iam.myhuaweicloud.com";
}

function makeCredentials(ak, sk, projectId, region) {
  const creds = new BasicCredentials()
    .withAk(ak)
    .withSk(sk);
  if (projectId) {
    creds.withProjectId(projectId);
  }
  if (region) {
    creds.withIamEndpoint(getIamEndpoint(region));
  }
  return creds;
}

function buildEcsClient(ak, sk, projectId, region) {
  const builder = EcsSdk.EcsClient.newBuilder()
    .withCredential(makeCredentials(ak, sk, projectId, region));
  try {
    builder.withRegion(EcsSdk.EcsRegion.valueOf(region));
  } catch {
    builder.withEndpoint(ecsEndpoint(region));
  }
  return builder.build();
}

function buildVpcClient(ak, sk, projectId, region) {
  const builder = VpcSdk.VpcClient.newBuilder()
    .withCredential(makeCredentials(ak, sk, projectId, region));
  try {
    builder.withRegion(VpcSdk.VpcRegion.valueOf(region));
  } catch {
    builder.withEndpoint(vpcEndpoint(region));
  }
  return builder.build();
}

function buildImsClient(ak, sk, projectId, region) {
  const builder = ImsSdk.ImsClient.newBuilder()
    .withCredential(makeCredentials(ak, sk, projectId, region));
  try {
    builder.withRegion(ImsSdk.ImsRegion.valueOf(region));
  } catch {
    builder.withEndpoint(imsEndpoint(region));
  }
  return builder.build();
}

// ---------------------------------------------------------------------------
// Public lookup functions
// ---------------------------------------------------------------------------

export async function listFlavors(ak, sk, projectId, region) {
  const client = buildEcsClient(ak, sk, projectId, region);
  const request = new EcsSdk.ListFlavorsRequest();
  const response = await client.listFlavors(request);
  return (response.flavors || []).map((f) => {
    const vcpus = Number(f.vcpus) || 0;
    const ramGiB = f.ram ? Math.round(Number(f.ram) / 1024) : 0;
    return {
      id: f.id,
      name: f.name,
      vcpus,
      ram: ramGiB,
      label: `${f.name} — ${vcpus} vCPU / ${ramGiB} GiB`,
    };
  });
}

export async function listImages(ak, sk, projectId, region) {
  const client = buildImsClient(ak, sk, projectId, region);
  let allImages = [];

  // Try public (gold) images first
  try {
    const request = new ImsSdk.ListImagesRequest();
    request.status = "active";
    request.imagetype = "gold";
    request.limit = 200;
    const response = await client.listImages(request);
    allImages = response.images || [];
  } catch {
    // Fallback: list without imagetype filter
    const fallbackReq = new ImsSdk.ListImagesRequest();
    fallbackReq.status = "active";
    fallbackReq.limit = 200;
    const fallbackRes = await client.listImages(fallbackReq);
    allImages = fallbackRes.images || [];
  }

  // Also include private custom images if any exist
  try {
    const privRequest = new ImsSdk.ListImagesRequest();
    privRequest.status = "active";
    privRequest.imagetype = "private";
    privRequest.limit = 100;
    const privResponse = await client.listImages(privRequest);
    if (privResponse.images && privResponse.images.length > 0) {
      allImages = [...allImages, ...privResponse.images];
    }
  } catch {
    // Non-fatal
  }

  return allImages.map((img) => ({
    id: img.id,
    name: img.name,
    os: img.platform || img.osType || "",
    status: img.status,
    label: `${img.name}${img.platform ? " (" + img.platform + ")" : ""}`,
  }));
}

export async function listAZs(ak, sk, projectId, region) {
  const client = buildEcsClient(ak, sk, projectId, region);
  const request = new EcsSdk.NovaListAvailabilityZonesRequest();
  const response = await client.novaListAvailabilityZones(request);
  return (response.availabilityZoneInfo || [])
    .filter((az) => az.zoneState?.available !== false)
    .map((az) => ({
      id: az.zoneName,
      label: az.zoneName,
    }));
}

export async function listVpcs(ak, sk, projectId, region) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const request = new VpcSdk.ListVpcsRequest();
  request.limit = 200;
  const response = await client.listVpcs(request);
  return (response.vpcs || []).map((v) => ({
    id: v.id,
    name: v.name,
    cidr: v.cidr,
    label: `${v.name} (${v.cidr})`,
  }));
}

export async function listSubnets(ak, sk, projectId, region, vpcId) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const request = new VpcSdk.ListSubnetsRequest();
  if (vpcId) request.vpcId = vpcId;
  request.limit = 200;
  const response = await client.listSubnets(request);
  return (response.subnets || []).map((s) => ({
    id: s.id,
    name: s.name,
    cidr: s.cidr,
    label: `${s.name} (${s.cidr})`,
  }));
}

export async function listSecurityGroups(ak, sk, projectId, region, vpcId) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const sgMap = new Map();

  // 1. Query standard VPC security groups
  try {
    const request = new VpcSdk.ListSecurityGroupsRequest();
    request.limit = 200;
    if (vpcId) request.vpcId = vpcId;
    const response = await client.listSecurityGroups(request);
    for (const sg of response.securityGroups || []) {
      if (sg.id && !sgMap.has(sg.id)) {
        const isDefault = sg.name?.toLowerCase() === "default";
        sgMap.set(sg.id, {
          id: sg.id,
          name: sg.name,
          vpcId: sg.vpcId,
          isDefault,
          label: `${sg.name}${isDefault ? " (Default Security Group)" : ""} (${sg.id.slice(0, 8)}…)`,
        });
      }
    }
  } catch (err) {
    console.warn("listSecurityGroups warning:", err?.message || err);
  }

  // 2. Query Neutron security groups (OpenStack API) which holds tenant default security groups
  try {
    const nRequest = new VpcSdk.NeutronListSecurityGroupsRequest();
    nRequest.limit = 200;
    const nResponse = await client.neutronListSecurityGroups(nRequest);
    for (const sg of nResponse.securityGroups || []) {
      if (sg.id && !sgMap.has(sg.id)) {
        const isDefault = sg.name?.toLowerCase() === "default";
        sgMap.set(sg.id, {
          id: sg.id,
          name: sg.name,
          isDefault,
          label: `${sg.name}${isDefault ? " (Default Security Group)" : ""} (${sg.id.slice(0, 8)}…)`,
        });
      }
    }
  } catch (err) {
    console.warn("neutronListSecurityGroups warning:", err?.message || err);
  }

  // 3. Specifically try fetching the default security group by name if not found yet
  const hasDefault = Array.from(sgMap.values()).some((sg) => sg.isDefault);
  if (!hasDefault) {
    try {
      const defReq = new VpcSdk.NeutronListSecurityGroupsRequest();
      defReq.name = "default";
      const defRes = await client.neutronListSecurityGroups(defReq);
      for (const sg of defRes.securityGroups || []) {
        if (sg.id && !sgMap.has(sg.id)) {
          sgMap.set(sg.id, {
            id: sg.id,
            name: sg.name,
            isDefault: true,
            label: `${sg.name} (Default Security Group) (${sg.id.slice(0, 8)}…)`,
          });
        }
      }
    } catch {}
  }

  // If VPC was filtered and nothing returned, try without vpcId filter
  if (vpcId && sgMap.size === 0) {
    try {
      const request = new VpcSdk.ListSecurityGroupsRequest();
      request.limit = 200;
      const response = await client.listSecurityGroups(request);
      for (const sg of response.securityGroups || []) {
        if (sg.id && !sgMap.has(sg.id)) {
          const isDefault = sg.name?.toLowerCase() === "default";
          sgMap.set(sg.id, {
            id: sg.id,
            name: sg.name,
            isDefault,
            label: `${sg.name}${isDefault ? " (Default Security Group)" : ""} (${sg.id.slice(0, 8)}…)`,
          });
        }
      }
    } catch {}
  }

  // Sort: default security groups at the top, then alphabetically
  const list = Array.from(sgMap.values());
  list.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  return list;
}

export async function listKeyPairs(ak, sk, projectId, region) {
  const client = buildEcsClient(ak, sk, projectId, region);
  const request = new EcsSdk.NovaListKeypairsRequest();
  const response = await client.novaListKeypairs(request);
  return (response.keypairs || []).map((kp) => {
    const k = kp.keypair || kp;
    return {
      name: k.name,
      label: k.name,
    };
  });
}

export async function listInstances(ak, sk, projectId, region) {
  const client = buildEcsClient(ak, sk, projectId, region);
  const request = new EcsSdk.ListServersDetailsRequest();
  request.limit = 100;
  const response = await client.listServersDetails(request);
  return (response.servers || []).map((srv) => {
    let publicIp = "";
    let privateIp = "";
    if (srv.addresses) {
      for (const netName of Object.keys(srv.addresses)) {
        for (const ipObj of srv.addresses[netName] || []) {
          const type = ipObj["OS-EXT-IPS:type"] || ipObj.type;
          if (type === "floating" && !publicIp) {
            publicIp = ipObj.addr;
          } else if (type === "fixed" && !privateIp) {
            privateIp = ipObj.addr;
          }
        }
      }
    }
    const osType = srv.metadata?.os_type || srv.metadata?.os_distro || "";
    const isWindows =
      String(osType).toLowerCase().includes("win") ||
      String(srv.name).toLowerCase().includes("win");

    return {
      id: srv.id,
      name: srv.name,
      status: srv.status,
      osType,
      isWindows,
      publicIp,
      privateIp,
      flavorId: srv.flavor?.name || srv.flavor?.id || "",
      az: srv.oSEXTAZAvailabilityZone || "",
      label: `${srv.name} (${srv.status}${publicIp ? ` · ${publicIp}` : ""}${isWindows ? " · Windows" : ""})`,
    };
  });
}

// ---------------------------------------------------------------------------
// Creation functions
// ---------------------------------------------------------------------------

/**
 * Create a new VPC.
 * @param {string} ak @param {string} sk @param {string|undefined} projectId
 * @param {string} region @param {{ name: string, cidr: string, description?: string }} opts
 */
export async function createVpc(ak, sk, projectId, region, { name, cidr, description }) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const request = new VpcSdk.CreateVpcRequest();
  const body = new VpcSdk.CreateVpcRequestBody();
  const vpc = new VpcSdk.CreateVpcOption();
  vpc.name = name;
  vpc.cidr = cidr;
  if (description) vpc.description = description;
  body.vpc = vpc;
  request.body = body;
  const response = await client.createVpc(request);
  const v = response.vpc;
  return {
    id: v.id,
    name: v.name,
    cidr: v.cidr,
    status: v.status,
  };
}

/**
 * Create a new Subnet inside a VPC.
 * @param {string} ak @param {string} sk @param {string|undefined} projectId
 * @param {string} region
 * @param {{ name: string, cidr: string, vpcId: string, gatewayIp?: string, dnsList?: string[] }} opts
 */
export async function createSubnet(ak, sk, projectId, region, { name, cidr, vpcId, gatewayIp, dnsList }) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const request = new VpcSdk.CreateSubnetRequest();
  const body = new VpcSdk.CreateSubnetRequestBody();
  const subnet = new VpcSdk.CreateSubnetOption();
  subnet.name = name;
  subnet.cidr = cidr;
  subnet.vpcId = vpcId;
  if (gatewayIp) subnet.gatewayIp = gatewayIp;
  if (dnsList && dnsList.length > 0) subnet.dnsList = dnsList;
  body.subnet = subnet;
  request.body = body;
  const response = await client.createSubnet(request);
  const s = response.subnet;
  return {
    id: s.id,
    name: s.name,
    cidr: s.cidr,
    vpcId: s.vpcId,
    gatewayIp: s.gatewayIp,
    status: s.status,
  };
}

function sdkErrorMessage(err) {
  return (
    err?.errorMsg ||
    err?.error_msg ||
    err?.data?.error_msg ||
    err?.data?.error?.message ||
    err?.data?.message ||
    err?.message ||
    String(err)
  );
}

function pick(obj, camel, snake) {
  if (!obj || typeof obj !== "object") return undefined;
  return obj[camel] ?? obj[snake];
}

function normalizeCidr(raw, ethertype = "IPv4") {
  let prefix = String(raw || "").trim();
  if (!prefix) return "";
  if (prefix.includes("/")) return prefix;
  if (ethertype === "IPv6") {
    if (prefix === "::") return "::/0";
    return `${prefix}/128`;
  }
  if (prefix === "0.0.0.0") return "0.0.0.0/0";
  return `${prefix}/32`;
}

function parsePortSpecs(portRange) {
  const raw = String(portRange || "").trim();
  if (!raw) return [null];
  const tokens = raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  const specs = [];
  for (const token of tokens) {
    if (token.includes("-")) {
      const [minStr, maxStr] = token.split("-").map((p) => p.trim());
      const min = Number(minStr);
      const max = Number(maxStr);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error(`Invalid port range: ${token}`);
      }
      specs.push({ min, max, label: `${min}-${max}` });
    } else {
      const port = Number(token);
      if (!Number.isFinite(port)) throw new Error(`Invalid port: ${token}`);
      specs.push({ min: port, max: port, label: String(port) });
    }
  }
  return specs.length ? specs : [null];
}

async function deleteDefaultSelfSourceIngress(client, sgId, existingRules) {
  const removed = [];
  for (const rule of existingRules || []) {
    const direction = pick(rule, "direction", "direction");
    const remoteGroupId = pick(rule, "remoteGroupId", "remote_group_id");
    const ruleId = pick(rule, "id", "id");
    if (!ruleId || direction !== "ingress" || !remoteGroupId) continue;
    const del = new VpcSdk.DeleteSecurityGroupRuleRequest();
    del.securityGroupRuleId = ruleId;
    await client.deleteSecurityGroupRule(del);
    removed.push(ruleId);
  }
  return removed;
}

async function addSecurityGroupRule(client, { sgId, direction, ethertype, protocol, portSpec, remoteIpPrefix }) {
  const opt = new VpcSdk.CreateSecurityGroupRuleOption();
  opt.withSecurityGroupId(sgId).withDirection(direction).withEthertype(ethertype);
  opt.withRemoteIpPrefix(remoteIpPrefix);
  // Never set remoteGroupId — that makes Source = this SG.

  const proto = String(protocol || "all").toLowerCase();
  if (proto && proto !== "all") {
    opt.withProtocol(proto);
  }
  if (portSpec && proto !== "all" && proto !== "icmp" && proto !== "icmpv6") {
    opt.withPortRangeMin(portSpec.min).withPortRangeMax(portSpec.max);
  }

  const ruleReq = new VpcSdk.CreateSecurityGroupRuleRequest();
  const ruleBody = new VpcSdk.CreateSecurityGroupRuleRequestBody();
  ruleBody.securityGroupRule = opt;
  ruleReq.body = ruleBody;

  const ruleRes = await client.createSecurityGroupRule(ruleReq);
  const created = pick(ruleRes, "securityGroupRule", "security_group_rule");
  if (!created) {
    throw new Error("Huawei Cloud did not return the created security group rule");
  }
  return created;
}

/**
 * Create a new Security Group and configure security group rules.
 * Huawei always adds a default inbound rule whose source is the new SG itself.
 * That default ingress rule is removed and replaced with the CIDR the user entered.
 */
export async function createSecurityGroup(ak, sk, projectId, region, { name, description, vpcId, rules }) {
  const client = buildVpcClient(ak, sk, projectId, region);
  const request = new VpcSdk.CreateSecurityGroupRequest();
  const body = new VpcSdk.CreateSecurityGroupRequestBody();
  const sg = new VpcSdk.CreateSecurityGroupOption();
  sg.name = name;
  if (description) sg.description = description;
  if (vpcId) sg.vpcId = vpcId;
  body.securityGroup = sg;
  request.body = body;

  const response = await client.createSecurityGroup(request);
  const g = pick(response, "securityGroup", "security_group");
  if (!g?.id) {
    throw new Error("Huawei Cloud created a security group but the response did not include its ID");
  }

  let defaultRules = pick(g, "securityGroupRules", "security_group_rules") || [];
  if (!defaultRules.length) {
    try {
      const listReq = new VpcSdk.ListSecurityGroupRulesRequest();
      listReq.securityGroupId = g.id;
      listReq.limit = 200;
      const listRes = await client.listSecurityGroupRules(listReq);
      defaultRules = pick(listRes, "securityGroupRules", "security_group_rules") || [];
    } catch (listErr) {
      console.warn("Could not list default security group rules:", sdkErrorMessage(listErr));
    }
  }
  let removedSelfSource = [];
  try {
    removedSelfSource = await deleteDefaultSelfSourceIngress(client, g.id, defaultRules);
  } catch (delErr) {
    console.warn("Could not remove default self-source ingress rule:", sdkErrorMessage(delErr));
  }

  const createdRules = [];
  const ruleErrors = [];

  if (rules && Array.isArray(rules) && rules.length > 0) {
    for (const ruleItem of rules) {
      const direction = ruleItem.direction || "ingress";
      const ethertype = ruleItem.ethertype || "IPv4";
      const protocol = ruleItem.protocol || "all";
      const prefixes = String(ruleItem.remoteIpPrefix || "")
        .split(",")
        .map((p) => normalizeCidr(p, ethertype))
        .filter(Boolean);

      if (!prefixes.length) {
        ruleErrors.push("Source IP / CIDR is required so the rule source is not the security group itself");
        continue;
      }

      let portSpecs;
      try {
        portSpecs =
          protocol === "all" || protocol === "icmp" || protocol === "icmpv6"
            ? [null]
            : parsePortSpecs(ruleItem.portRange);
      } catch (portErr) {
        ruleErrors.push(portErr.message);
        continue;
      }

      for (const prefix of prefixes) {
        for (const portSpec of portSpecs) {
          try {
            const created = await addSecurityGroupRule(client, {
              sgId: g.id,
              direction,
              ethertype,
              protocol,
              portSpec,
              remoteIpPrefix: prefix,
            });
            createdRules.push({
              id: created.id,
              direction,
              ethertype,
              protocol,
              portRange: portSpec?.label || (protocol === "icmp" ? "ICMP" : "all"),
              remoteIpPrefix: pick(created, "remoteIpPrefix", "remote_ip_prefix") || prefix,
              remoteGroupId: pick(created, "remoteGroupId", "remote_group_id") || "",
            });
          } catch (ruleErr) {
            ruleErrors.push(`${prefix}: ${sdkErrorMessage(ruleErr)}`);
          }
        }
      }
    }
  }

  const result = {
    id: g.id,
    name: g.name,
    description: g.description,
    rules: createdRules,
    removedSelfSourceRules: removedSelfSource.length,
    warnings: ruleErrors,
  };

  if (ruleErrors.length && createdRules.length === 0) {
    const err = new Error(
      `Security group "${g.name}" was created (${g.id}), but inbound IP rules were not added: ${ruleErrors.join("; ")}`
    );
    err.securityGroup = result;
    throw err;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dispatcher — call any lookup by resource name
// ---------------------------------------------------------------------------

const HANDLERS = {
  flavors: listFlavors,
  images: listImages,
  azs: listAZs,
  vpcs: listVpcs,
  subnets: listSubnets,
  securityGroups: listSecurityGroups,
  keyPairs: listKeyPairs,
  instances: listInstances,
};

/**
 * @param {{ accessKey, secretKey, projectId, region, resource, vpcId? }} params
 * @returns {Promise<{ ok: boolean, items?: any[], error?: string }>}
 */
export async function lookup(params) {
  const { accessKey, secretKey, projectId, region, resource, vpcId } = params;

  const handler = HANDLERS[resource];
  if (!handler) {
    return { ok: false, error: `Unknown resource type: ${resource}` };
  }

  try {
    const items =
      resource === "subnets" || resource === "securityGroups"
        ? await handler(accessKey, secretKey, projectId, region, vpcId)
        : await handler(accessKey, secretKey, projectId, region);

    return { ok: true, items };
  } catch (err) {
    const message =
      err?.errorMsg ||
      err?.data?.error_msg ||
      err?.data?.message ||
      err?.message ||
      String(err);
    return { ok: false, error: message };
  }
}
