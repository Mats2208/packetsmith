#!/usr/bin/env sh
# curl -fsSL https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.sh | sh
#
# Baja el binario que corresponde a esta máquina desde la última release y lo
# deja en el PATH. No necesita Bun, ni Node, ni npm: el binario se lleva el
# runtime adentro.
#
# `sh` y no `bash` a propósito: en Alpine no hay bash, y Alpine es justo donde
# la variante musl importa.
set -eu

REPO="Mats2208/packetsmith"
INSTALL_DIR="${PACKETSMITH_INSTALL_DIR:-$HOME/.packetsmith/bin}"

decir() { printf '%s\n' "$*" >&2; }
morir() { decir "packetsmith: $*"; exit 1; }

# ── Qué binario le toca ──────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin) SO="darwin" ;;
  Linux)  SO="linux" ;;
  *) morir "sistema no soportado: $(uname -s). En Windows usá install.ps1." ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) morir "arquitectura no soportada: $(uname -m)" ;;
esac

# En Linux hay dos ABIs y no son intercambiables: un binario de glibc en Alpine
# no arranca, y el error no dice por qué. `ldd --version` nombra a musl cuando
# es musl; en glibc dice otra cosa o falla, y ahí el fallback correcto es glibc.
ABI=""
if [ "$SO" = "linux" ] && (ldd --version 2>&1 || true) | grep -qi musl; then
  ABI="-musl"
fi

DESTINO="packetsmith-${SO}-${ARCH}${ABI}"

# ── Bajarlo ──────────────────────────────────────────────────────────────────
VERSION="${PACKETSMITH_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4) \
    || morir "no pude averiguar la última versión. ¿Hay red?"
fi
[ -n "$VERSION" ] || morir "no hay ninguna release publicada todavía."

URL="https://github.com/${REPO}/releases/download/${VERSION}/${DESTINO}.tar.gz"
TMP=$(mktemp -d)
# Se limpia pase lo que pase: un /tmp con cien megas de binario a medio bajar es
# una forma fea de fallar.
trap 'rm -rf "$TMP"' EXIT INT TERM

decir "bajando packetsmith ${VERSION} para ${SO}-${ARCH}${ABI}…"
curl -fsSL "$URL" -o "$TMP/p.tar.gz" \
  || morir "no existe un binario para ${SO}-${ARCH}${ABI} en ${VERSION}.
Contalo en https://github.com/${REPO}/issues y mientras tanto podés correrlo
desde el código: https://github.com/${REPO}#install"

tar -xzf "$TMP/p.tar.gz" -C "$TMP"
mkdir -p "$INSTALL_DIR"
# `mv` sobre un binario en uso falla en algunos sistemas; se instala al lado y
# se renombra, que es atómico.
mv "$TMP/packetsmith" "$INSTALL_DIR/packetsmith.nuevo"
chmod +x "$INSTALL_DIR/packetsmith.nuevo"
mv "$INSTALL_DIR/packetsmith.nuevo" "$INSTALL_DIR/packetsmith"

decir ""
decir "listo → $INSTALL_DIR/packetsmith"

# ── Decirle cómo ponerlo en el PATH ──────────────────────────────────────────
#
# NO se edita el perfil de nadie: tocar el .zshrc de alguien sin preguntar es de
# mala educación, y encima cada uno usa un shell distinto. Se dice la línea.
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    decir ""
    decir "Falta agregarlo al PATH. Poné esta línea en tu perfil:"
    decir ""
    decir "  export PATH=\"$INSTALL_DIR:\$PATH\""
    decir ""
    case "$(basename "${SHELL:-}")" in
      zsh)  decir "  (para zsh, va en ~/.zshrc)" ;;
      bash) decir "  (para bash, va en ~/.bashrc o ~/.bash_profile)" ;;
      fish) decir "  (para fish: fish_add_path $INSTALL_DIR)" ;;
    esac
    ;;
esac

decir ""
decir "Después: packetsmith --help"
decir "Y para el MCP de Packet Tracer, una vez: packetsmith setup"
