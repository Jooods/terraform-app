import { Client } from "ssh2";
import fs from "node:fs/promises";

/**
 * Parses GitHub repo URL or string into owner, repo, and download URL.
 */
export function parseGitHubRepo(repoUrl, branch = "main", token = "") {
  let clean = String(repoUrl || "").trim().replace(/\.git$/, "");
  const match = clean.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+)/i);
  if (!match) {
    throw new Error("Invalid GitHub repository. Format should be: https://github.com/owner/repo or owner/repo");
  }
  const owner = match[1];
  const repo = match[2];
  const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  return { owner, repo, branch, zipUrl };
}

/**
 * Generates the common OS detection and web server setup bash snippet.
 * Includes if-else branching for different Linux distributions and package managers.
 */
function getLinuxDistroSetupSnippet() {
  return `
# Ensure script runs as root; re-exec with sudo if executed by non-root user
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        echo ">>> Running with sudo privileges..."
        SUDO_CMD="sudo"
    else
        echo "ERROR: Root privileges or sudo required to install web server packages." >&2
        exit 1
    fi
else
    SUDO_CMD=""
fi

echo "========================================================================="
echo " Linux ECS Automation — Multi-Distro Web Server & Static Site Setup"
echo "========================================================================="

# ── Detect Linux Distribution ──
OS_ID=""
OS_LIKE=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="\${ID:-}"
    OS_LIKE="\${ID_LIKE:-}"
elif [ -f /etc/redhat-release ]; then
    OS_ID="rhel"
elif [ -f /etc/debian_version ]; then
    OS_ID="debian"
fi

echo "Detected OS ID: '\${OS_ID:-unknown}', OS LIKE: '\${OS_LIKE:-none}'"

# ── Distribution-Specific Package Manager & Web Server Setup (If-Else) ──
PKG_MGR=""
WEB_PKG=""
SVC_NAME=""
WEB_ROOT="/var/www/html"

if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || echo "$OS_LIKE" | grep -qi "debian"; then
    echo ">>> [Distribution Family: Debian/Ubuntu] Using 'apt-get' with 'apache2'..."
    PKG_MGR="apt"
    WEB_PKG="apache2"
    SVC_NAME="apache2"
    WEB_ROOT="/var/www/html"

    echo ">>> [1/5] Updating repositories and installing \${WEB_PKG}, curl, unzip, tar..."
    export DEBIAN_FRONTEND=noninteractive
    $SUDO_CMD apt-get update -y
    $SUDO_CMD apt-get install -y apache2 curl unzip tar ca-certificates

elif [ "$OS_ID" = "euleros" ] || [ "$OS_ID" = "openEuler" ] || [ "$OS_ID" = "hce" ] || [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "fedora" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -qiE "rhel|fedora|centos"; then
    echo ">>> [Distribution Family: Huawei Cloud EulerOS / openEuler / RHEL / CentOS] Using 'httpd'..."
    if command -v dnf >/dev/null 2>&1; then
        PKG_MGR="dnf"
    else
        PKG_MGR="yum"
    fi
    WEB_PKG="httpd"
    SVC_NAME="httpd"
    WEB_ROOT="/var/www/html"

    echo ">>> [1/5] Installing \${WEB_PKG}, curl, unzip, tar using \${PKG_MGR}..."
    $SUDO_CMD $PKG_MGR install -y httpd curl unzip tar ca-certificates

elif [ "$OS_ID" = "alpine" ]; then
    echo ">>> [Distribution Family: Alpine Linux] Using 'apk' with 'apache2'..."
    PKG_MGR="apk"
    WEB_PKG="apache2"
    SVC_NAME="apache2"
    WEB_ROOT="/var/www/localhost/htdocs"

    echo ">>> [1/5] Installing \${WEB_PKG}, curl, unzip, tar using apk..."
    $SUDO_CMD apk update
    $SUDO_CMD apk add --no-cache apache2 curl unzip tar ca-certificates

elif [ "$OS_ID" = "sles" ] || [ "$OS_ID" = "opensuse" ] || echo "$OS_LIKE" | grep -qi "suse"; then
    echo ">>> [Distribution Family: SUSE / openSUSE] Using 'zypper' with 'apache2'..."
    PKG_MGR="zypper"
    WEB_PKG="apache2"
    SVC_NAME="apache2"
    WEB_ROOT="/srv/www/htdocs"

    echo ">>> [1/5] Installing \${WEB_PKG}, curl, unzip, tar using zypper..."
    $SUDO_CMD zypper refresh
    $SUDO_CMD zypper --non-interactive install apache2 curl unzip tar ca-certificates

elif [ "$OS_ID" = "arch" ] || echo "$OS_LIKE" | grep -qi "arch"; then
    echo ">>> [Distribution Family: Arch Linux] Using 'pacman' with 'apache'..."
    PKG_MGR="pacman"
    WEB_PKG="apache"
    SVC_NAME="httpd"
    WEB_ROOT="/srv/http"

    echo ">>> [1/5] Installing \${WEB_PKG}, curl, unzip, tar using pacman..."
    $SUDO_CMD pacman -Sy --noconfirm apache curl unzip tar ca-certificates

else
    echo ">>> [Distribution Family: Generic Linux Fallback] Checking installed package managers..."
    if command -v apt-get >/dev/null 2>&1; then
        PKG_MGR="apt"
        WEB_PKG="apache2"
        SVC_NAME="apache2"
        WEB_ROOT="/var/www/html"
        export DEBIAN_FRONTEND=noninteractive
        $SUDO_CMD apt-get update -y
        $SUDO_CMD apt-get install -y apache2 curl unzip tar ca-certificates
    elif command -v dnf >/dev/null 2>&1; then
        PKG_MGR="dnf"
        WEB_PKG="httpd"
        SVC_NAME="httpd"
        WEB_ROOT="/var/www/html"
        $SUDO_CMD dnf install -y httpd curl unzip tar ca-certificates
    elif command -v yum >/dev/null 2>&1; then
        PKG_MGR="yum"
        WEB_PKG="httpd"
        SVC_NAME="httpd"
        WEB_ROOT="/var/www/html"
        $SUDO_CMD yum install -y httpd curl unzip tar ca-certificates
    elif command -v apk >/dev/null 2>&1; then
        PKG_MGR="apk"
        WEB_PKG="apache2"
        SVC_NAME="apache2"
        WEB_ROOT="/var/www/localhost/htdocs"
        $SUDO_CMD apk update
        $SUDO_CMD apk add --no-cache apache2 curl unzip tar ca-certificates
    elif command -v zypper >/dev/null 2>&1; then
        PKG_MGR="zypper"
        WEB_PKG="apache2"
        SVC_NAME="apache2"
        WEB_ROOT="/srv/www/htdocs"
        $SUDO_CMD zypper refresh
        $SUDO_CMD zypper --non-interactive install apache2 curl unzip tar ca-certificates
    else
        echo "ERROR: Unsupported Linux distribution or no recognized package manager found." >&2
        exit 1
    fi
fi

echo ">>> [2/5] Preparing web root directory at \${WEB_ROOT}..."
$SUDO_CMD mkdir -p "\${WEB_ROOT}"
# Remove default Apache or distribution welcome pages
$SUDO_CMD rm -f "\${WEB_ROOT}/index.html" "\${WEB_ROOT}/index.nginx-debian.html" "\${WEB_ROOT}/welcome.conf"
`;
}

/**
 * Common finalizing snippet for starting the web service, opening firewall, and setting permissions.
 */
function getLinuxFinalizeSnippet() {
  return `
echo "Deploying extracted files to \${WEB_ROOT}..."
$SUDO_CMD cp -rf "\${SRC_DIR}"/* "\${WEB_ROOT}"/
$SUDO_CMD cp -rf "\${SRC_DIR}"/.[!.]* "\${WEB_ROOT}"/ 2>/dev/null || true

# Set appropriate permissions
$SUDO_CMD chmod -R 755 "\${WEB_ROOT}"
$SUDO_CMD chown -R root:root "\${WEB_ROOT}" 2>/dev/null || true

# Clean up temp files
rm -f "$TEMP_ZIP"
rm -rf "$EXTRACT_DIR"

# Handle SELinux (EulerOS / CentOS / RHEL / Fedora)
if command -v getenforce >/dev/null 2>&1; then
    if [ "$(getenforce)" != "Disabled" ]; then
        echo "Configuring SELinux context for \${WEB_ROOT}..."
        $SUDO_CMD chcon -R -t httpd_sys_content_t "\${WEB_ROOT}" 2>/dev/null || $SUDO_CMD restorecon -Rv "\${WEB_ROOT}" 2>/dev/null || true
    fi
fi

echo ">>> [5/5] Ensuring \${SVC_NAME} service is running and enabled..."
if command -v systemctl >/dev/null 2>&1; then
    $SUDO_CMD systemctl daemon-reload 2>/dev/null || true
    $SUDO_CMD systemctl enable "\${SVC_NAME}" 2>/dev/null || true
    $SUDO_CMD systemctl restart "\${SVC_NAME}"
    echo "Service \${SVC_NAME} active status:"
    $SUDO_CMD systemctl is-active "\${SVC_NAME}" || true
elif command -v service >/dev/null 2>&1; then
    $SUDO_CMD service "\${SVC_NAME}" restart
elif command -v rc-service >/dev/null 2>&1; then
    $SUDO_CMD rc-update add "\${SVC_NAME}" default 2>/dev/null || true
    $SUDO_CMD rc-service "\${SVC_NAME}" restart
fi

# Configure local firewall if active
if command -v ufw >/dev/null 2>&1; then
    $SUDO_CMD ufw allow 80/tcp 2>/dev/null || true
    $SUDO_CMD ufw allow 443/tcp 2>/dev/null || true
fi
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    $SUDO_CMD firewall-cmd --permanent --add-service=http 2>/dev/null || true
    $SUDO_CMD firewall-cmd --permanent --add-service=https 2>/dev/null || true
    $SUDO_CMD firewall-cmd --reload 2>/dev/null || true
fi

echo ""
echo "========================================================================="
echo "SUCCESS: Web server (\${WEB_PKG}) configured and application deployed to \${WEB_ROOT}"
echo "========================================================================="
echo "[DEPLOYMENT_SUCCESS_CONFIRMED]"
exit 0
`;
}

/**
 * Builds the Bash deployment script for Linux using GitHub archive download.
 */
export function buildLinuxDeploymentScript({ zipUrl, token = "" }) {
  const distroSetup = getLinuxDistroSetupSnippet();
  const finalize = getLinuxFinalizeSnippet();

  return `#!/bin/bash
set -e

${distroSetup}

echo ">>> [3/5] Downloading static website from GitHub: ${zipUrl}..."
TEMP_ZIP="/tmp/app_repo_$(date +%s%N).zip"
EXTRACT_DIR="/tmp/app_extract_$(date +%s%N)"
rm -f "$TEMP_ZIP"
rm -rf "$EXTRACT_DIR"

DOWNLOAD_SUCCESS=0
for attempt in 1 2 3; do
    echo "Download attempt $attempt of 3..."
    ${
      token
        ? `curl -fSL --retry 2 -H "Authorization: Bearer ${token}" -H "User-Agent: Mozilla/5.0" -o "$TEMP_ZIP" "${zipUrl}" && DOWNLOAD_SUCCESS=1 && break`
        : `curl -fSL --retry 2 -H "User-Agent: Mozilla/5.0" -o "$TEMP_ZIP" "${zipUrl}" && DOWNLOAD_SUCCESS=1 && break`
    }
    sleep 2
done

if [ "$DOWNLOAD_SUCCESS" -ne 1 ]; then
    echo "ERROR: Failed to download GitHub archive from ${zipUrl}" >&2
    exit 1
fi

echo ">>> [4/5] Extracting application files..."
mkdir -p "$EXTRACT_DIR"
if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$TEMP_ZIP" -d "$EXTRACT_DIR"
elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$TEMP_ZIP" "$EXTRACT_DIR"
else
    echo "ERROR: Neither unzip nor python3 is available to extract zip file." >&2
    exit 1
fi

# Locate inner content folder if repository was packaged inside a root folder
FIRST_CHILD="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
CHILD_COUNT="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 | wc -l)"

if [ "$CHILD_COUNT" -eq 1 ] && [ -d "$FIRST_CHILD" ]; then
    SRC_DIR="$FIRST_CHILD"
else
    SRC_DIR="$EXTRACT_DIR"
fi

${finalize}
`;
}

/**
 * Builds the Bash deployment script for Linux using a base64-embedded zip file.
 */
export function buildLinuxDeploymentScriptFromZip(base64Zip) {
  const distroSetup = getLinuxDistroSetupSnippet();
  const finalize = getLinuxFinalizeSnippet();

  return `#!/bin/bash
set -e

${distroSetup}

echo ">>> [3/5] Decoding uploaded static website zip..."
TEMP_ZIP="/tmp/app_upload_$(date +%s%N).zip"
EXTRACT_DIR="/tmp/app_extract_$(date +%s%N)"
rm -f "$TEMP_ZIP"
rm -rf "$EXTRACT_DIR"

cat << 'EOF_ZIP_B64' | base64 -d > "$TEMP_ZIP"
${base64Zip}
EOF_ZIP_B64

echo "Decoded application archive ($(( $(wc -c < "$TEMP_ZIP") / 1024 )) KB)."

echo ">>> [4/5] Extracting application files..."
mkdir -p "$EXTRACT_DIR"
if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$TEMP_ZIP" -d "$EXTRACT_DIR"
elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$TEMP_ZIP" "$EXTRACT_DIR"
else
    echo "ERROR: Neither unzip nor python3 is available to extract zip file." >&2
    exit 1
fi

# Locate inner content folder if zip contained a single parent folder
FIRST_CHILD="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
CHILD_COUNT="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 | wc -l)"

if [ "$CHILD_COUNT" -eq 1 ] && [ -d "$FIRST_CHILD" ]; then
    SRC_DIR="$FIRST_CHILD"
else
    SRC_DIR="$EXTRACT_DIR"
fi

${finalize}
`;
}

/**
 * Connects to a remote Linux ECS instance over SSH and executes a script.
 */
function executeScriptOverSsh({ host, port = 22, username = "root", password, privateKey, scriptContent, onLog }) {
  return new Promise((resolve) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";

    conn.on("ready", () => {
      onLog?.({ level: "info", message: `SSH connection established to ${host}:${port} as ${username}.` });
      onLog?.({ level: "info", message: "Executing Linux deployment automation script..." });

      conn.exec("bash -s", (err, stream) => {
        if (err) {
          conn.end();
          return resolve({ ok: false, error: `Failed to execute remote bash command: ${err.message}` });
        }

        stream.on("data", (data) => {
          const text = data.toString();
          stdout += text;
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) onLog?.({ level: "info", message: line.trim() });
          }
        });

        stream.stderr.on("data", (data) => {
          const text = data.toString();
          stderr += text;
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) onLog?.({ level: "warn", message: line.trim() });
          }
        });

        stream.on("close", (code) => {
          conn.end();
          const confirmed = code === 0 && stdout.includes("[DEPLOYMENT_SUCCESS_CONFIRMED]");
          if (confirmed) {
            resolve({ ok: true, stdout, stderr, code });
          } else {
            resolve({
              ok: false,
              error: `Remote script exited with code ${code}. Check logs for details.`,
              stdout,
              stderr,
              code,
            });
          }
        });

        // Feed the script to bash standard input
        stream.end(scriptContent);
      });
    });

    conn.on("error", (err) => {
      onLog?.({ level: "warn", message: `SSH connection error: ${err.message}` });
      resolve({ ok: false, connectionError: true, error: err.message });
    });

    try {
      const connectConfig = {
        host,
        port: Number(port) || 22,
        username: username.trim() || "root",
        readyTimeout: 20000,
      };

      if (privateKey) {
        connectConfig.privateKey = privateKey;
      }
      if (password) {
        connectConfig.password = password;
      }

      onLog?.({ level: "info", message: `Connecting to ${host}:${connectConfig.port} via SSH (user: ${connectConfig.username})...` });
      conn.connect(connectConfig);
    } catch (e) {
      resolve({ ok: false, connectionError: true, error: e.message });
    }
  });
}

/**
 * Runs a Linux Automation job from a GitHub repository.
 */
export async function runLinuxAutomationJob({
  jobId,
  host,
  username = "root",
  password = "",
  privateKey = "",
  repoUrl,
  branch = "main",
  githubToken = "",
  onLog,
}) {
  if (!password && !privateKey) {
    return { ok: false, error: "Root password or Private Key is required for Linux deployment." };
  }

  onLog?.({ level: "info", message: `Starting Linux Automation for target host: ${host}` });

  // 1. Validate and parse GitHub Repo
  let repoInfo;
  try {
    repoInfo = parseGitHubRepo(repoUrl, branch, githubToken);
    onLog?.({
      level: "info",
      message: `Parsed GitHub repository: ${repoInfo.owner}/${repoInfo.repo} (branch: ${repoInfo.branch})`,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // 2. Build deployment script with multi-distro if-else logic
  const scriptContent = buildLinuxDeploymentScript({
    zipUrl: repoInfo.zipUrl,
    token: githubToken,
  });

  onLog?.({ level: "info", message: "Generated multi-distro Linux Bash deployment script." });

  // 3. Attempt direct SSH execution
  const websiteUrl = `http://${host}`;
  const result = await executeScriptOverSsh({
    host,
    username,
    password,
    privateKey,
    scriptContent,
    onLog,
  });

  if (result.ok) {
    onLog?.({ level: "info", message: `Deployment complete! Website is live at: ${websiteUrl}` });
    return {
      ok: true,
      mode: "ssh",
      websiteUrl,
      outputs: {
        websiteUrl,
        host,
        repo: `${repoInfo.owner}/${repoInfo.repo}`,
      },
    };
  }

  // If SSH failed to connect (e.g. port 22 blocked in SG, or key/password issue)
  if (result.connectionError) {
    onLog?.({
      level: "warn",
      message: "Remote SSH port 22 could not be reached, or authentication failed.",
    });
    onLog?.({
      level: "info",
      message: "You can open port 22 in your Security Group, or copy & run the 1-Click Bash Script below directly on the server console (VNC).",
    });

    return {
      ok: false,
      mode: "script_ready",
      error: `SSH connection failed: ${result.error}. (Tip: Check Security Group port 22 or run the 1-Click Script below).`,
      websiteUrl,
      script: scriptContent,
      outputs: {
        websiteUrl,
        host,
        repo: `${repoInfo.owner}/${repoInfo.repo}`,
        notice: "Bash script ready. If SSH port 22 is restricted, paste the 1-Click script into your Linux terminal or VNC console.",
      },
    };
  }

  // SSH connected but script execution failed
  onLog?.({ level: "error", message: `Linux deployment script execution failed: ${result.error}` });
  return {
    ok: false,
    error: `Deployment script execution failed on the remote Linux server: ${result.error}`,
    script: scriptContent,
    websiteUrl,
    outputs: {
      websiteUrl,
      host,
      repo: `${repoInfo.owner}/${repoInfo.repo}`,
      notice: "Deployment encountered an error. Review the logs above or run the Bash script manually.",
    },
  };
}

/**
 * Runs a Linux Automation job where a zip file is uploaded directly.
 */
export async function runLinuxUploadJob({
  jobId,
  host,
  username = "root",
  password = "",
  privateKey = "",
  zipPath,
  uploadedName,
  onLog,
}) {
  if (!password && !privateKey) {
    return { ok: false, error: "Root password or Private Key is required for Linux deployment." };
  }

  onLog?.({ level: "info", message: `Starting file-upload Linux Automation for host: ${host}` });
  onLog?.({ level: "info", message: `Upload source: ${uploadedName}` });

  // 1. Read uploaded zip and base64-encode it
  let zipBytes;
  try {
    zipBytes = await fs.readFile(zipPath);
  } catch (err) {
    return { ok: false, error: `Failed to read uploaded zip: ${err.message}` };
  }

  if (zipBytes.length > 100 * 1024 * 1024) {
    return { ok: false, error: "Uploaded file exceeds 100 MB limit." };
  }

  const base64Zip = zipBytes.toString("base64");
  onLog?.({ level: "info", message: `Encoded zip (${(zipBytes.length / 1024).toFixed(0)} KB) for embedded transfer.` });

  // 2. Build multi-distro deployment script
  const scriptContent = buildLinuxDeploymentScriptFromZip(base64Zip);
  onLog?.({ level: "info", message: "Generated multi-distro Linux Bash deployment script (upload mode)." });

  // 3. Attempt direct SSH execution
  const websiteUrl = `http://${host}`;
  const result = await executeScriptOverSsh({
    host,
    username,
    password,
    privateKey,
    scriptContent,
    onLog,
  });

  if (result.ok) {
    onLog?.({ level: "info", message: `Upload deployment complete! Website is live at: ${websiteUrl}` });
    return {
      ok: true,
      mode: "ssh_upload",
      websiteUrl,
      outputs: {
        websiteUrl,
        host,
        source: uploadedName,
      },
    };
  }

  if (result.connectionError) {
    onLog?.({
      level: "warn",
      message: "Remote SSH port 22 could not be reached, or authentication failed.",
    });
    return {
      ok: false,
      mode: "script_ready",
      error: `SSH connection failed: ${result.error}. (Tip: Check Security Group port 22 or run the 1-Click Script below).`,
      websiteUrl,
      script: scriptContent,
      outputs: {
        websiteUrl,
        host,
        source: uploadedName,
        notice: "Bash script ready. If SSH is blocked, paste the 1-Click script into your Linux terminal or VNC console.",
      },
    };
  }

  return {
    ok: false,
    error: `Upload deployment script failed on remote Linux server: ${result.error}`,
    script: scriptContent,
    websiteUrl,
    outputs: {
      websiteUrl,
      host,
      source: uploadedName,
    },
  };
}
