#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
# ============================================================
#  build-and-install.sh  (development install)
#  1. Builds the zip package in dist/ (the one for
#     extensions.gnome.org), with the settings schema, after checking
#     that every sentence has its Italian translation
#  2. Installs and enables Smart Calendar Hub for this user
#
#  On Wayland GNOME Shell loads the new code only after you
#  log out and back in.
# ============================================================
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
    echo "ERROR: do not run this script with sudo." >&2
    exit 1
fi

PROJ_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
EXT_SRC="$PROJ_DIR/extension"
DIST="$PROJ_DIR/dist"
EXT_ROOT="$HOME/.local/share/gnome-shell/extensions"

EXT_UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT_SRC/metadata.json")"
if [[ -z "$EXT_UUID" ]]; then
    echo "ERROR: no UUID in metadata.json" >&2
    exit 1
fi
ZIP="$DIST/$EXT_UUID.shell-extension.zip"

# --- 1. Package ---
# Every sentence of the code must have its Italian translation (sch-i18n.js)
python3 -I "$PROJ_DIR/tools/check-translations.py"
glib-compile-schemas --strict --dry-run "$EXT_SRC/schemas"
mkdir -p "$DIST"
gnome-extensions pack "$EXT_SRC" \
    --force \
    --out-dir="$DIST" \
    --schema="schemas/org.gnome.shell.extensions.smart-calendar-hub.gschema.xml" \
    --extra-source="sch-i18n.js" \
    --extra-source="sch-clocks-source.js" \
    --extra-source="sch-alarm-watch.js" \
    --extra-source="sch-widgets.js" \
    --extra-source="sch-panel-widgets.js" \
    --extra-source="sch-profiles.js" \
    --extra-source="sch-profile-switch.js" \
    --extra-source="sch-profile-auto.js" \
    --extra-source="sch-calendar.js" \
    --extra-source="sch-eds.js" \
    --extra-source="sch-sky.js" \
    --extra-source="sch-net.js" \
    --extra-source="sch-spacing.js" \
    --extra-source="sch-clock-weather.js" \
    --extra-source="sch-topbar-style.js" \
    --extra-source="sch-battery.js" \
    --extra-source="sch-astro.js" \
    --extra-source="sch-world-clocks.js" \
    --extra-source="sch-weather.js" \
    --extra-source="sch-page-kit.js" \
    --extra-source="sch-log.js" \
    --extra-source="sch-banner-guard.js" \
    --extra-source="sch-ext-settings.js" \
    --extra-source="sch-settings-model.js" \
    --extra-source="sch-hub-settings.js" \
    --extra-source="sch-vesperal-location.js" \
    --extra-source="sch-year-chart.js" \
    --extra-source="sch-signals.js" \
    --extra-source="sch-side-panel.js" \
    --extra-source="sch-tray.js" \
    --extra-source="sch-panel-pages.js" \
    --extra-source="sch-menu-tidy.js" \
    --extra-source="sch-side-card.js" \
    --extra-source="sch-settings-swaps.js" \
    --extra-source="sch-panel-geometry.js" \
    --extra-source="sch-resize-edge.js" \
    --extra-source="sch-weather-section.js" \
    --extra-source="sch-today.js" \
    --extra-source="sch-bottom-row.js" \
    --extra-source="sch-notifications.js" \
    --extra-source="sch-alert-dot.js" \
    --extra-source="sch-ext-icons.js" \
    --extra-source="sch-top-bar-organizer.js" \
    --extra-source="sch-updates.js" \
    --extra-source="sch-version-check.js" \
    --extra-source="icons" \
    --extra-source="$PROJ_DIR/LICENSE"
echo "Package built: $ZIP"

# --- 2. Install and enable ---
gnome-extensions install --force "$ZIP"
# Schema compiled in the installed folder (needed by getSettings)
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
echo " Smart Calendar Hub installed."
echo " ⚠  To load it, log out and log in again (required on Wayland)."
echo "============================================================"
