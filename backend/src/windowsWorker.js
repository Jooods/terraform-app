import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Parses GitHub repo URL or string into owner, repo, and download URL.
 */
export function parseGitHubRepo(repoUrl, branch = "main", token = "") {
  let clean = String(repoUrl || "").trim().replace(/\.git$/, "");
  // Support forms: https://github.com/owner/repo or owner/repo
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
 * Builds the PowerShell script to be executed on the Windows ECS server.
 */
export function buildDeploymentScript({ zipUrl, token = "" }) {
  const authHeader = token ? ` -Headers @{ "Authorization" = "Bearer ${token}" }` : "";

  return `
# =========================================================================
# Windows ECS Automation — IIS & Static GitHub App Deployment
# =========================================================================
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

# Ensure TLS 1.2 is enabled for secure GitHub connections
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]12288
} catch {}

Write-Host ">>> [1/5] Checking and Installing IIS Web Server..."
try {
    $iisFeature = Get-WindowsFeature -Name Web-Server -ErrorAction Stop
    if (-not $iisFeature.Installed) {
        Write-Host "Installing IIS (Web-Server and Management Tools)..."
        Install-WindowsFeature -Name Web-Server -IncludeManagementTools
        Write-Host "IIS installed successfully."
    } else {
        Write-Host "IIS is already installed. Skipping install step."
    }
} catch {
    Write-Host "WARNING: Could not check IIS status ($($_.Exception.Message)). Assuming IIS is installed."
}

Write-Host ">>> [2/5] Preparing web root at C:\\inetpub\\wwwroot..."
if (-not (Test-Path "C:\\inetpub\\wwwroot")) {
    New-Item -ItemType Directory -Path "C:\\inetpub\\wwwroot" -Force | Out-Null
}

# Remove default IIS welcome splash files
if (Test-Path "C:\\inetpub\\wwwroot\\iisstart.htm") {
    Remove-Item "C:\\inetpub\\wwwroot\\iisstart.htm" -Force -ErrorAction SilentlyContinue
}
if (Test-Path "C:\\inetpub\\wwwroot\\iisstart.png") {
    Remove-Item "C:\\inetpub\\wwwroot\\iisstart.png" -Force -ErrorAction SilentlyContinue
}

Write-Host ">>> [3/5] Downloading application repository from GitHub..."
$tempZip = "$env:TEMP\\app_repo_$((Get-Random)).zip"
$extractDir = "$env:TEMP\\app_extract_$((Get-Random))"

$downloaded = $false
$maxRetries = 3

for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    Write-Host "Download attempt $attempt of $maxRetries from ${zipUrl}..."
    if (Test-Path $tempZip) { Remove-Item $tempZip -Force -ErrorAction SilentlyContinue }

    # Strategy 1: System.Net.WebClient (Fastest, streams directly to disk, does not stall WinRM pipeline)
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        ${token ? `$wc.Headers.Add("Authorization", "Bearer ${token}")` : "# No token"}
        $wc.DownloadFile("${zipUrl}", $tempZip)
        if ((Test-Path $tempZip) -and ((Get-Item $tempZip).Length -gt 1000)) {
            $downloaded = $true
            Write-Host "Downloaded successfully via System.Net.WebClient ($((Get-Item $tempZip).Length) bytes)."
            break
        }
    } catch {
        Write-Host "WebClient attempt failed: $($_.Exception.Message)"
    }

    # Strategy 2: curl.exe (built-in on Windows Server 2019+, robust TLS & redirect handling)
    if (-not $downloaded -and (Get-Command "curl.exe" -ErrorAction SilentlyContinue)) {
        try {
            Write-Host "Trying download via curl.exe..."
            ${token ? `& curl.exe -fSL --retry 2 -H "Authorization: Bearer ${token}" -H "User-Agent: Mozilla/5.0" -o $tempZip "${zipUrl}"` : `& curl.exe -fSL --retry 2 -H "User-Agent: Mozilla/5.0" -o $tempZip "${zipUrl}"`}
            if ((Test-Path $tempZip) -and ((Get-Item $tempZip).Length -gt 1000)) {
                $downloaded = $true
                Write-Host "Downloaded successfully via curl.exe ($((Get-Item $tempZip).Length) bytes)."
                break
            }
        } catch {
            Write-Host "curl.exe attempt failed: $($_.Exception.Message)"
        }
    }

    # Strategy 3: Invoke-WebRequest with explicit User-Agent and progress disabled
    if (-not $downloaded) {
        try {
            Write-Host "Trying download via Invoke-WebRequest..."
            $iwrHeaders = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            ${token ? `$iwrHeaders["Authorization"] = "Bearer ${token}"` : ""}
            Invoke-WebRequest -Uri "${zipUrl}" -Headers $iwrHeaders -OutFile $tempZip -UseBasicParsing -TimeoutSec 180
            if ((Test-Path $tempZip) -and ((Get-Item $tempZip).Length -gt 1000)) {
                $downloaded = $true
                Write-Host "Downloaded successfully via Invoke-WebRequest ($((Get-Item $tempZip).Length) bytes)."
                break
            }
        } catch {
            Write-Host "Invoke-WebRequest attempt failed: $($_.Exception.Message)"
        }
    }

    if (-not $downloaded -and $attempt -lt $maxRetries) {
        Write-Host "Waiting 3 seconds before retry..."
        Start-Sleep -Seconds 3
    }
}

if (-not $downloaded) {
    Write-Error "Failed to download repository zip from ${zipUrl} after $maxRetries attempts."
    exit 1
}

Write-Host ">>> [4/5] Extracting application files..."
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

# Expand-Archive was introduced in PowerShell 5.0.
# Fall back to System.IO.Compression.ZipFile (.NET 4.5) or Shell.Application COM.
$extracted = $false
if ($PSVersionTable.PSVersion.Major -ge 5) {
    try {
        Expand-Archive -Path $tempZip -DestinationPath $extractDir -Force
        $extracted = $true
        Write-Host "Extracted via Expand-Archive."
    } catch { Write-Host "Expand-Archive failed: $($_.Exception.Message). Trying .NET fallback..." }
}
if (-not $extracted) {
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $extractDir)
        $extracted = $true
        Write-Host "Extracted via System.IO.Compression.ZipFile."
    } catch { Write-Host ".NET ZipFile failed: $($_.Exception.Message). Trying Shell.Application fallback..." }
}
if (-not $extracted) {
    try {
        $shell = New-Object -ComObject Shell.Application
        $zip   = $shell.NameSpace($tempZip)
        $dest  = $shell.NameSpace($extractDir)
        $dest.CopyHere($zip.Items(), 0x14)
        $extracted = $true
        Write-Host "Extracted via Shell.Application COM."
    } catch {
        Write-Error "All extraction methods failed. Error: $($_.Exception.Message)"
        exit 1
    }
}

# Locate the root extracted content folder
$innerFolder = (Get-ChildItem -Path $extractDir | Where-Object { $_.PSIsContainer } | Select-Object -First 1).FullName
$sourceDir = if ($innerFolder) { $innerFolder } else { $extractDir }

Write-Host "Deploying files from $sourceDir to C:\\inetpub\\wwwroot..."
Copy-Item -Path "$sourceDir\\*" -Destination "C:\\inetpub\\wwwroot" -Recurse -Force

# Cleanup temp archive
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ">>> [5/5] Ensuring IIS World Wide Web Publishing Service (W3SVC) is Running..."
Restart-Service W3SVC -Force
$status = (Get-Service W3SVC).Status
Write-Host "IIS Service status: $status"

Write-Host ""
Write-Host "========================================================================="
Write-Host "SUCCESS: IIS configured and static application deployed to C:\\inetpub\\wwwroot"
Write-Host "========================================================================="
Write-Host "[DEPLOYMENT_SUCCESS_CONFIRMED]"
`;
}

/**
 * Runs the Windows Automation job.
 */
export async function runWindowsAutomationJob({
  jobId,
  host,
  adminPass,
  repoUrl,
  branch = "main",
  githubToken = "",
  onLog,
}) {
  if (!adminPass) {
    return { ok: false, error: "Admin password is required for Windows deployment." };
  }
  onLog?.({ level: "info", message: `Starting Windows Automation for target host: ${host}` });
  // Debug: log admin password presence (do not log actual password)
  onLog?.({ level: "debug", message: `Admin password provided: ${adminPass ? 'yes' : 'no'}` });

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

  // 2. Build deployment script
  const scriptContent = buildDeploymentScript({
    zipUrl: repoInfo.zipUrl,
    token: githubToken,
  });

  onLog?.({ level: "info", message: "Generated PowerShell deployment automation script." });

  // 3. Prepare temporary script files
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "win_deploy_"));
  const localScriptPath = path.join(tmpDir, "deploy.ps1");
  const winrmScriptPath = path.join(tmpDir, "winrm_connect.ps1");
  await fs.writeFile(localScriptPath, scriptContent, "utf8");

  // Write the WinRM connection script to a .ps1 file so PowerShell loads with
  // a full session context (fixes ConvertTo-SecureString / Microsoft.PowerShell.Security
  // module load failures that occur when using the inline -Command flag).
  const winrmScript = `
$ProgressPreference = "SilentlyContinue"
Import-Module Microsoft.PowerShell.Security -ErrorAction SilentlyContinue
$secPass = ConvertTo-SecureString '${adminPass.replace(/'/g, "''")}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential ('Administrator', $secPass)
$sessionOpt = New-PSSessionOption -SkipCACheck -SkipCNCheck

try {
    Write-Host "Testing WinRM connection to ${host}:5985..."
    $session = New-PSSession -ComputerName '${host}' -Credential $cred -SessionOption $sessionOpt -ErrorAction Stop
} catch {
    Write-Host "[WINRM_UNAVAILABLE]: Remote WinRM connection could not be established ($($_.Exception.Message))."
    exit 2
}

try {
    Write-Host "WinRM session established. Running deployment script on remote Windows server..."
    Invoke-Command -Session $session -FilePath '${localScriptPath.replace(/'/g, "''")}' -ErrorAction Stop
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment script exited with code $LASTEXITCODE."
    }
    Remove-PSSession $session
    Write-Host "[DEPLOYMENT_SUCCESS_CONFIRMED]"
    Write-Host "Remote execution completed successfully."
    exit 0
} catch {
    Write-Host "[DEPLOYMENT_FAILED]: $($_.Exception.Message)"
    if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
    exit 1
}
`;

  await fs.writeFile(winrmScriptPath, winrmScript, "utf8");

  // 4. Check if remote execution via WinRM is available
  onLog?.({ level: "info", message: `Attempting remote connection to ${host} via PowerShell Remoting (WinRM)...` });

  return new Promise((resolve) => {
    // Use -File instead of -Command so PowerShell starts in a full session
    // context, ensuring security modules (ConvertTo-SecureString, etc.) load correctly.
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winrmScriptPath], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let winrmFailed = false;

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (text.includes("[WINRM_UNAVAILABLE]")) {
        winrmFailed = true;
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          onLog?.({ level: "info", message: line.trim() });
        }
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          onLog?.({ level: "warn", message: line.trim() });
        }
      }
    });

    child.on("close", async (code) => {
      // Clean up local temp file
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      const websiteUrl = `http://${host}`;
      const isConfirmedSuccess =
        code === 0 &&
        !winrmFailed &&
        stdout.includes("[DEPLOYMENT_SUCCESS_CONFIRMED]") &&
        !stdout.includes("[DEPLOYMENT_FAILED]");

      if (isConfirmedSuccess) {
        onLog?.({ level: "info", message: `Deployment complete! Website is live at: ${websiteUrl}` });
        return resolve({
          ok: true,
          mode: "winrm",
          websiteUrl,
          outputs: {
            websiteUrl,
            host,
            repo: `${repoInfo.owner}/${repoInfo.repo}`,
          },
        });
      }

      // If remote WinRM was not open/accessible from the outside (very common in cloud VMs)
      if (winrmFailed) {
        onLog?.({
          level: "warn",
          message: "Remote WinRM port 5985 is blocked by the Windows Security Group or not yet initialized.",
        });
        onLog?.({
          level: "info",
          message: "You can open port 5985 in the Security Group, or run the 1-Click PowerShell Script generated below on the server.",
        });

        return resolve({
          ok: false,
          mode: "script_ready",
          error: "Remote WinRM port 5985 is blocked by the Windows Security Group or not yet initialized.",
          websiteUrl,
          script: scriptContent,
          outputs: {
            websiteUrl,
            host,
            repo: `${repoInfo.owner}/${repoInfo.repo}`,
            notice: "PowerShell script ready. If WinRM is restricted, paste the 1-click script into PowerShell on the server.",
          },
        });
      }

      // WinRM connected, but remote deployment script failed
      onLog?.({
        level: "error",
        message: "Deployment script execution failed on the remote Windows server.",
      });

      resolve({
        ok: false,
        error: "Deployment script execution failed on the remote Windows server. Check the logs above for details.",
        script: scriptContent,
        websiteUrl,
        outputs: {
          websiteUrl,
          host,
          repo: `${repoInfo.owner}/${repoInfo.repo}`,
          notice: "Deployment encountered an error. Review the logs above or run the PowerShell script manually.",
        },
      });
    });

    child.on("error", async (err) => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      onLog?.({ level: "error", message: `Automation process error: ${err.message}` });
      resolve({
        ok: false,
        error: err.message,
      });
    });
  });
}
