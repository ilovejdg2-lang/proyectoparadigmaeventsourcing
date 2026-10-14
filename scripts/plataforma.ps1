param(
  [Parameter(Position = 0)]
  [ValidateSet("up", "down", "demo", "publicar")]
  [string]$Action = "up"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Wait-Apis {
  $deadline = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $deadline) {
    try {
      $tx = Invoke-WebRequest -Uri "http://localhost:3000/transactions" -UseBasicParsing
      $history = Invoke-WebRequest -Uri "http://localhost:3001/history/transactions" -UseBasicParsing
      $front = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing
      if ($tx.StatusCode -eq 200 -and $history.StatusCode -eq 200 -and $front.StatusCode -eq 200) {
        return
      }
    } catch {
      # Todavía arrancando.
    }
    Start-Sleep -Seconds 3
  }
  throw "Transaction API, History API o el frontend no respondieron a tiempo."
}

switch ($Action) {
  "up" {
    docker compose up -d --build
    Wait-Apis
    Write-Output "Plataforma lista."
    Write-Output "  Frontend:  http://localhost:5173/"
    Write-Output "  Swagger:   http://localhost:3000/api/docs"
    Write-Output "  Historial: http://localhost:3001/"
  }
  "down" {
    docker compose down
  }
  "demo" {
    docker compose up -d --build
    Wait-Apis
    npm run simular
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output ""
    Write-Output "Demo lista para mostrar."
    Write-Output "  Frontend:  http://localhost:5173/"
    Write-Output "  Historial: http://localhost:3001/"
    Write-Output "  Swagger:   http://localhost:3000/api/docs"
  }
  "publicar" {
    if (-not $env:DOCKERHUB_USER) {
      throw "Define DOCKERHUB_USER con tu usuario de Docker Hub antes de publicar."
    }
    docker compose build
    docker compose push
  }
}
