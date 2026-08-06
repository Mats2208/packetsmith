# Deja el token de npm cargado en GitHub para que la release publique sola.
#
#   .\scripts\npm-token.ps1
#
# Pide el token, lo guarda como secret `NPM_TOKEN` y enciende `PUBLISH_NPM`.
#
# El token NO se escribe en ningún lado: se lee sin eco, se pasa por una tubería
# —no como argumento, que se vería en la lista de procesos— y nunca toca el
# historial ni el disco. Esa es toda la razón de que esto exista: `gh secret set`
# toma el NOMBRE como argumento y el VALOR por stdin, y ponerlos al revés deja el
# token como nombre del secret. Los nombres de secrets no son secretos.

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

function Rojo($m)  { Write-Host $m -ForegroundColor Red }
function Verde($m) { Write-Host $m -ForegroundColor Green }
function Gris($m)  { Write-Host $m -ForegroundColor DarkGray }

# ── Que estén las herramientas ───────────────────────────────────────────────
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Rojo "Falta el CLI de GitHub (gh). Se instala en https://cli.github.com"
  exit 1
}
gh auth status *> $null
if (-not $?) {
  Rojo "No hay sesion de GitHub. Corre:  gh auth login"
  exit 1
}

$repo = gh repo view --json nameWithOwner -q .nameWithOwner
Write-Host ""
Gris "repo: $repo"
Write-Host ""

# ── El token ─────────────────────────────────────────────────────────────────
Write-Host "Pega el token de npm y dale ENTER (no se va a ver mientras lo pegas):"
$seguro = Read-Host -AsSecureString
Write-Host ""

# Se pasa a texto solo el instante que hace falta, y se libera la memoria
# nativa enseguida.
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($token)) {
  Rojo "No pegaste nada."
  exit 1
}

# Los tokens de npm empiezan con `npm_`. Avisar aca evita descubrirlo dentro de
# un workflow, veinte minutos despues, con un 401 que no dice por que.
if (-not $token.StartsWith("npm_")) {
  Rojo "Eso no parece un token de npm - los de npm empiezan con `"npm_`"."
  Rojo "Se saca en https://www.npmjs.com/settings/~/tokens"
  exit 1
}

# ── Guardarlo ────────────────────────────────────────────────────────────────
# Por tuberia y no con --body: un argumento se ve en la lista de procesos
# mientras el comando corre.
$token | gh secret set NPM_TOKEN
$token = $null
[GC]::Collect()

gh variable set PUBLISH_NPM --body true | Out-Null

Verde "Listo."
Write-Host ""
Gris "  NPM_TOKEN    guardado como secret"
Gris "  PUBLISH_NPM  = true"
Write-Host ""
Write-Host "Ahora, para publicar:"
Write-Host ""
Write-Host "  gh workflow run release.yml -f tag=v0.3.1"
Write-Host ""
Gris "El token no quedo en tu historial, ni en un archivo, ni en pantalla."
