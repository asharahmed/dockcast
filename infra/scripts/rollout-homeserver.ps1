# DockCast rollout on the Windows home server (docs/infra.md §16).
# Run by deploy.yml over ssh after every green push to main, or by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File rollout-homeserver.ps1 -Sha <commit>
# Fetches the repo tarball for that commit, refreshes C:\dockcast (compose file, Caddyfile,
# crontab, scripts; infra\.env is untouched), pulls the published images and restarts the
# stack, then waits for the api container to report healthy. Named volumes are preserved.
#
# Native commands run through `cmd /c "... 2>&1"`: under Windows PowerShell 5.1 a `2>&1` done by
# PowerShell itself turns every stderr line (Docker's progress output) into a terminating error.
param(
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$Repo = "asharahmed/dockcast",
  [string]$Dir = "C:\dockcast",
  [string]$Project = "dockcast",
  [string]$HealthUrl = "http://localhost:8088/api/v1/health"
)
$ErrorActionPreference = "Stop"

function Invoke-Native([string]$Label, [string]$CommandLine, [int]$Tail = 6) {
  Write-Output "== $Label"
  $out = @(cmd /c "$CommandLine 2>&1")
  if ($LASTEXITCODE -ne 0) {
    $out | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }
    throw "$Label failed (exit $LASTEXITCODE)"
  }
  $out | Select-Object -Last $Tail | ForEach-Object { Write-Output $_ }
}

$tgz = Join-Path $env:TEMP "dockcast-$Sha.tgz"
Invoke-Native "fetch $Repo@$Sha" "curl.exe -fsSL -o `"$tgz`" https://github.com/$Repo/archive/$Sha.tar.gz" 2
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir | Out-Null }
Invoke-Native "extract to $Dir" "tar.exe -xzf `"$tgz`" -C `"$Dir`" --strip-components=1" 2
Remove-Item $tgz
Set-Location $Dir
$dc = "docker compose -p $Project -f infra/docker-compose.yml"

Invoke-Native "pull images" "$dc pull" 6
Invoke-Native "restart stack" "$dc up -d --remove-orphans" 8
cmd /c "docker image prune -f 2>&1" | Out-Null
Invoke-Native "containers" "$dc ps --format `"{{.Name}} {{.Status}}`"" 12

Write-Output "== health"
$deadline = (Get-Date).AddSeconds(120)
do {
  $status = (cmd /c "docker inspect --format {{.State.Health.Status}} $Project-api-1 2>&1" | Out-String).Trim()
  if ($status -eq "healthy") {
    $body = (cmd /c "curl.exe -s -m 10 $HealthUrl 2>&1" | Out-String).Trim()
    Write-Output "api healthy; $HealthUrl -> $body"
    exit 0
  }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)
throw "api container not healthy within 120 s (last status: $status)"
