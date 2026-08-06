#!/usr/bin/env bash
# Deja el token de npm cargado en GitHub para que la release publique sola.
#
#   bash scripts/npm-token.sh
#
# Pide el token, lo guarda como secret `NPM_TOKEN` y enciende `PUBLISH_NPM`.
#
# El token NO se escribe en ningún lado: se lee sin eco, se pasa por una tubería
# —no como argumento, que se vería en `ps`— y nunca toca el historial ni el
# disco. Esa es toda la razón de que este script exista: `gh secret set` toma el
# NOMBRE como argumento y el VALOR por stdin, y ponerlos al revés deja el token
# como nombre del secret. Los nombres de secrets no son secretos.
set -euo pipefail

cd "$(dirname "$0")/.."

rojo()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

# ── Que estén las herramientas ───────────────────────────────────────────────
command -v gh >/dev/null 2>&1 || {
  rojo "Falta el CLI de GitHub (gh). Se instala en https://cli.github.com"
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  rojo "No hay sesión de GitHub. Corré:  gh auth login"
  exit 1
}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
printf '\n'
gris "repo: $REPO"
printf '\n'

# ── El token ─────────────────────────────────────────────────────────────────
printf 'Pegá el token de npm y dale ⏎ (no se va a ver mientras lo pegás):\n'
printf '> '
# `-s` no lo muestra; `-r` no interpreta las barras invertidas, que en un token
# no significan nada pero podrían romperlo.
read -rs TOKEN
printf '\n\n'

[ -n "$TOKEN" ] || { rojo "No pegaste nada."; exit 1; }

# Los tokens de npm empiezan con `npm_`. Avisar acá evita descubrirlo dentro de
# un workflow, veinte minutos después, con un 401 que no dice por qué.
case "$TOKEN" in
  npm_*) ;;
  *)
    rojo "Eso no parece un token de npm — los de npm empiezan con \"npm_\"."
    rojo "Se saca en https://www.npmjs.com/settings/~/tokens"
    exit 1
    ;;
esac

# ── Guardarlo ────────────────────────────────────────────────────────────────
# Por tubería y no con --body: un argumento se ve en la lista de procesos
# mientras el comando corre.
printf '%s' "$TOKEN" | gh secret set NPM_TOKEN
unset TOKEN

gh variable set PUBLISH_NPM --body true >/dev/null

verde "Listo."
printf '\n'
gris "  NPM_TOKEN    guardado como secret"
gris "  PUBLISH_NPM  = true"
printf '\n'
printf 'Ahora, para publicar:\n\n'
printf '  gh workflow run release.yml -f tag=v0.3.1\n\n'
gris "El token no quedó en tu historial, ni en un archivo, ni en pantalla."
