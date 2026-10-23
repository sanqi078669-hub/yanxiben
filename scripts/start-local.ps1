$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (-not (Test-Path -LiteralPath 'data/session-secret')) { npm run init; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
Write-Host '研习本本地地址：http://127.0.0.1:3000'
Write-Host '初始账号信息：data/local-login.txt'
npm run dev
