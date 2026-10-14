# Levanta la plataforma completa con las imágenes publicadas en Docker Hub.
#
#   .\run.ps1          baja las imágenes y levanta los contenedores
#   .\run.ps1 -Build   construye las imágenes desde el código (necesita ..\eventsourcingfrontend)
#   .\run.ps1 -Down    apaga los contenedores; el historial queda en el volumen

param(
  [switch]$Build,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker no está corriendo. Abre Docker Desktop y vuelve a intentar." }

if ($Down) {
  docker compose down
  exit $LASTEXITCODE
}

if ($Build) {
  docker compose up -d --build
} else {
  docker compose pull
  if ($LASTEXITCODE -ne 0) { throw "No se pudieron bajar las imágenes de Docker Hub." }
  docker compose up -d --no-build
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$urls = @(
  "http://localhost:3000/transactions",
  "http://localhost:3001/history/transactions",
  "http://localhost:5173/"
)
$deadline = (Get-Date).AddMinutes(4)
foreach ($url in $urls) {
  while ($true) {
    try {
      if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { break }
    } catch {
      if ((Get-Date) -gt $deadline) { throw "No respondió a tiempo: $url (revisa: docker compose logs)" }
      Start-Sleep -Seconds 3
    }
  }
}

Write-Output ""
Write-Output "Plataforma lista."
Write-Output "  Frontend:          http://localhost:5173/"
Write-Output "  Transaction API:   http://localhost:3000/api/docs"
Write-Output "  History API:       http://localhost:3001/"
Write-Output ""
Write-Output "Para generar datos de demo: npm run simular"
