# FinPilot 14.2: isolated PostgreSQL guest security integration test.
# Must be launched from a trusted local checkout; Docker Desktop is required.
# Does NOT change the normal docker-compose.yml, server/.env, or development DB.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker-compose.qa.yml'
$project = 'finpilot-security-qa'
$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$names = @('DATABASE_URL', 'APP_DATABASE_URL', 'INTEGRATION_DATABASE_URL', 'SESSION_SECRET', 'NODE_ENV')
$saved = @{}
foreach ($name in $names) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Push-Location $root
try {
  if (-not $dockerAvailable) {
    throw 'Docker CLI was not found. Install/start Docker Desktop first.'
  }
  Write-Host '[QA] Starting isolated PostgreSQL on 127.0.0.1:5436...'
  & docker compose -p $project -f $compose up -d --wait postgres-qa
  if ($LASTEXITCODE -ne 0) { throw 'QA PostgreSQL failed to start.' }

  $admin = 'postgresql://finpilot_qa_admin:qa_admin_local_only_password@127.0.0.1:5436/finpilot_security_qa'
  $app = 'postgresql://finpilot_qa_app:qa_app_local_only_password@127.0.0.1:5436/finpilot_security_qa'
  [Environment]::SetEnvironmentVariable('DATABASE_URL', $admin, 'Process')
  [Environment]::SetEnvironmentVariable('APP_DATABASE_URL', $app, 'Process')
  [Environment]::SetEnvironmentVariable('INTEGRATION_DATABASE_URL', $app, 'Process')
  [Environment]::SetEnvironmentVariable('SESSION_SECRET', 'finpilot-security-qa-only-secret-2026', 'Process')
  [Environment]::SetEnvironmentVariable('NODE_ENV', 'test', 'Process')

  Push-Location (Join-Path $root 'server')
  try {
    Write-Host '[QA] Applying migrations in the QA database only...'
    & npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'QA database migrations failed.' }
    Write-Host '[QA] Checking TypeScript...'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend TypeScript build failed.' }
    Write-Host '[QA] Running REAL PostgreSQL/RLS integration tests...'
    & npm test -- tests/guest-isolation.test.ts tests/recurring-worker.test.ts
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL integration tests failed.' }
    Write-Host '[QA] Running the recurring command with the restricted role...'
    & npm run recurring:apply
    if ($LASTEXITCODE -ne 0) { throw 'Recurring job failed.' }
    Write-Host '[QA] PostgreSQL integration checks PASSED.'
  }
  finally { Pop-Location }
}
finally {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
  }
  # Remove only the separate QA container/network, preserving its QA volume.
  Write-Host '[QA] Stopping QA containers; preserving the QA-only volume...'
  if ($dockerAvailable) {
    try {
      & docker compose -p $project -f $compose down
      if ($LASTEXITCODE -ne 0) { Write-Warning 'QA docker compose down failed; inspect Docker Desktop.' }
    }
    catch { Write-Warning ('Failed to stop QA containers: ' + $_.Exception.Message) }
  }
  Pop-Location
}
