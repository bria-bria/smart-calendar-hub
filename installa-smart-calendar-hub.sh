#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
# ============================================================
#  installa-smart-calendar-hub.sh  (installazione di sviluppo)
#  1. Crea il pacchetto zip in dist/ (lo stesso da caricare su
#     extensions.gnome.org), con schema delle impostazioni e traduzioni
#     (prima controlla che ogni frase abbia la traduzione italiana)
#  2. Disattiva e rimuove la vecchia "raven-calendar@michele.local"
#  3. Installa e attiva Smart Calendar Hub
#
#  Su Wayland il codice nuovo di GNOME Shell si carica solo dopo
#  logout/login. Le Preferenze invece si aggiornano subito.
# ============================================================
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
    echo "ERRORE: non lanciare questo script con sudo." >&2
    exit 1
fi

PROJ_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
EXT_SRC="$PROJ_DIR/extension"
DIST="$PROJ_DIR/dist"
EXT_ROOT="$HOME/.local/share/gnome-shell/extensions"
OLD_UUID="raven-calendar@michele.local"

EXT_UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT_SRC/metadata.json")"
if [[ -z "$EXT_UUID" ]]; then
    echo "ERRORE: UUID non trovato in metadata.json" >&2
    exit 1
fi
ZIP="$DIST/$EXT_UUID.shell-extension.zip"

# --- 1. Pacchetto ---
# Ogni frase del codice deve avere la sua traduzione italiana (sch-i18n.js)
python3 -I "$PROJ_DIR/strumenti/controlla-traduzioni.py"
glib-compile-schemas --strict --dry-run "$EXT_SRC/schemas"
mkdir -p "$DIST"
gnome-extensions pack "$EXT_SRC" \
    --force \
    --out-dir="$DIST" \
    --schema="schemas/org.gnome.shell.extensions.smart-calendar-hub.gschema.xml" \
    --extra-source="sch-i18n.js" \
    --extra-source="sch-calendar.js" \
    --extra-source="sch-eds.js" \
    --extra-source="$PROJ_DIR/LICENSE"
echo "Pacchetto creato: $ZIP"

# --- 2. Toglie la vecchia estensione ---
if [[ -d "$EXT_ROOT/$OLD_UUID" ]]; then
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf -- "${EXT_ROOT:?}/$OLD_UUID"
    echo "Rimossa la vecchia estensione $OLD_UUID."
fi

# --- 3. Installa e attiva ---
gnome-extensions install --force "$ZIP"
# Schema compilato nella cartella installata (serve a getSettings)
glib-compile-schemas "$EXT_ROOT/$EXT_UUID/schemas"

if ! gnome-extensions enable "$EXT_UUID" 2>/dev/null; then
    CURRENT="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$CURRENT" != *"'$EXT_UUID'"* ]]; then
        if [[ "$CURRENT" == "@as []" || "$CURRENT" == "[]" ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$EXT_UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${CURRENT%]}, '$EXT_UUID']"
        fi
    fi
fi

echo "============================================================"
echo " Smart Calendar Hub installata."
echo " ⚠  Per caricarla fai LOGOUT e poi LOGIN (su Wayland è obbligatorio)."
echo "============================================================"
