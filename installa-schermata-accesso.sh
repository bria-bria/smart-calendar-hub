#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
#
# Smart Calendar Hub on the login screen (GDM): only the look of the top
# bar (accent colour, space between the icons, clock position), the same as
# in your session. Nothing else of the extension runs there.
#
#   sudo ./installa-schermata-accesso.sh            install / update
#   sudo ./installa-schermata-accesso.sh --rimuovi  remove, login screen as before
#
# What it does:
#  1. copies the extension to /usr/share/gnome-shell/extensions (for all)
#  2. reads YOUR settings (accent colour, tone, spacing, clock position)
#  3. writes them as settings of the gdm user, in a system dconf database
#     (/etc/dconf/db/gdm.d), and enables the extension there
# Run it again after changing those settings or updating the extension.

set -euo pipefail

UUID=smart-calendar-hub@bria-bria.github.io
DIR=$(cd "$(dirname "$0")" && pwd)
ZIP="$DIR/dist/$UUID.shell-extension.zip"
DEST=/usr/share/gnome-shell/extensions/$UUID
PROFILE=/etc/dconf/profile/gdm
KEYFILE=/etc/dconf/db/gdm.d/90-smart-calendar-hub

if [ "$(id -u)" -ne 0 ]; then
    echo "Lancialo con sudo: sudo $0 $*"
    exit 1
fi

if [ "${1:-}" = "--rimuovi" ]; then
    rm -rf "$DEST"
    rm -f "$KEYFILE"
    # the profile is ours only if it carries our mark
    if grep -q "smart-calendar-hub" "$PROFILE" 2>/dev/null; then
        rm -f "$PROFILE"
    fi
    dconf update
    echo "Tolto. La schermata di accesso torna com'era dal prossimo avvio."
    exit 0
fi

if [ ! -f "$ZIP" ]; then
    echo "Manca $ZIP: prima lancia ./installa-smart-calendar-hub.sh"
    exit 1
fi
if [ -z "${SUDO_USER:-}" ]; then
    echo "Lancialo con sudo dal tuo utente (serve per leggere le tue impostazioni)."
    exit 1
fi

# 1. the extension for all users
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$ZIP" -d "$DEST"
glib-compile-schemas "$DEST/schemas"
chmod -R a+rX "$DEST"

# 2. your settings (dconf read works without a session bus); a key you
# never changed is empty: then the default of the extension
read_key() {
    local value
    value=$(sudo -u "$SUDO_USER" dconf read "$1" 2>/dev/null || true)
    echo "${value:-$2}"
}
S=/org/gnome/shell/extensions/smart-calendar-hub
ACCENT_BAR=$(read_key "$S/accent-top-bar" "false")
TONE=$(read_key "$S/accent-top-bar-tone" "'light'")
SPACING=$(read_key "$S/top-bar-spacing" "12")
POSITION=$(read_key "$S/top-bar-position" "'right-between-tray-and-menu'")
ACCENT=$(read_key /org/gnome/desktop/interface/accent-color "'blue'")

# 3. a system database for the gdm user (the default profile has none)
if [ ! -f "$PROFILE" ]; then
    cat > "$PROFILE" <<EOF
# added by smart-calendar-hub (installa-schermata-accesso.sh)
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
EOF
elif ! grep -q "^system-db:gdm" "$PROFILE"; then
    echo "Attenzione: $PROFILE esiste già senza 'system-db:gdm'."
    echo "Aggiungi a mano la riga 'system-db:gdm' dopo 'user-db:user'."
fi
mkdir -p "$(dirname "$KEYFILE")"
cat > "$KEYFILE" <<EOF
# Smart Calendar Hub on the login screen (installa-schermata-accesso.sh)
[org/gnome/shell]
enabled-extensions=['$UUID']

[org/gnome/shell/extensions/smart-calendar-hub]
accent-top-bar=$ACCENT_BAR
accent-top-bar-tone=$TONE
top-bar-spacing=$SPACING
top-bar-position=$POSITION

[org/gnome/desktop/interface]
accent-color=$ACCENT
EOF
dconf update

echo "Fatto. Impostazioni portate sulla schermata di accesso:"
echo "  colore d'accento nella barra: $ACCENT_BAR (tonalità $TONE, accento $ACCENT)"
echo "  spazio tra le icone: $SPACING   posizione dell'ora: $POSITION"
echo "Si vedono al prossimo avvio del PC (o al prossimo logout)."
