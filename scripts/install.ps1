# irm https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.ps1 | iex
#
# Baja el binario de Windows desde la última release y lo deja en el PATH del
# usuario. No necesita Bun, ni Node, ni npm.

$ErrorActionPreference = "Stop"

$Repo = "Mats2208/packetsmith"
$Destino = if ($env:PACKETSMITH_INSTALL_DIR) { $env:PACKETSMITH_INSTALL_DIR }
           else { Join-Path $env:USERPROFILE ".packetsmith\bin" }

function Morir($msg) { Write-Host "packetsmith: $msg" -ForegroundColor Red; exit 1 }

# Windows ARM ejecuta binarios x64 por emulación, así que x64 sirve para las dos.
# Cuando haya un binario ARM nativo, esto elige el que corresponda.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "x64" } else { "x64" }

$version = if ($env:PACKETSMITH_VERSION) { $env:PACKETSMITH_VERSION } else {
  try {
    (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest").tag_name
  } catch { Morir "no pude averiguar la última versión. Revisá la conexión." }
}
if (-not $version) { Morir "no hay ninguna release publicada todavía." }

$nombre = "packetsmith-windows-$arch"
$url = "https://github.com/$Repo/releases/download/$version/$nombre.zip"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("packetsmith-" + [guid]::NewGuid())

Write-Host "bajando packetsmith $version para windows-$arch..."
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  try {
    Invoke-WebRequest -Uri $url -OutFile "$tmp\p.zip" -UseBasicParsing
  } catch {
    Morir "no existe un binario para windows-$arch en $version.`nContalo en https://github.com/$Repo/issues"
  }

  Expand-Archive -Path "$tmp\p.zip" -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  # Copiar y renombrar: reemplazar un .exe en uso falla, y el mensaje de Windows
  # para eso no ayuda a nadie.
  Copy-Item "$tmp\packetsmith.exe" "$Destino\packetsmith.exe" -Force
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "listo -> $Destino\packetsmith.exe"

# El PATH del USUARIO, no el del sistema: no hace falta ser administrador y no
# se le toca nada a nadie más en la máquina.
$actual = [Environment]::GetEnvironmentVariable("Path", "User")
if ($actual -notlike "*$Destino*") {
  [Environment]::SetEnvironmentVariable("Path", "$Destino;$actual", "User")
  Write-Host ""
  Write-Host "Agregado al PATH del usuario. Abrí una terminal nueva para que tome efecto."
}

Write-Host ""
Write-Host "Despues: packetsmith --help"
Write-Host "Y para el MCP de Packet Tracer, una vez: packetsmith setup"
