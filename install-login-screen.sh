#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
#
# Smart Calendar Hub on the login screen (GDM): only the look of the top
# bar (accent colour, space between the icons, clock position, battery as a
# circle), the same as in your session. No other part of the extension
# runs there.
#
#   sudo ./install-login-screen.sh           install / update
#   sudo ./install-login-screen.sh --remove  remove, login screen as before
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
    echo "Run it with sudo: sudo $0 $*"
    exit 1
fi

if [ "${1:-}" = "--remove" ]; then
    rm -rf "$DEST"
    rm -f "$KEYFILE"
    # the profile is ours only if it carries our mark
    if grep -q "smart-calendar-hub" "$PROFILE" 2>/dev/null; then
        rm -f "$PROFILE"
    fi
    dconf update
    echo "Removed. The login screen will be back as it was after the next restart."
    exit 0
fi

if [ -z "${SUDO_USER:-}" ]; then
    echo "Run it with sudo from your own user (it reads your settings)."
    exit 1
fi

# The extension to copy: the zip built from the project (dist/), or else the
# one already installed for your user (e.g. from extensions.gnome.org)
USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
INSTALLED="$USER_HOME/.local/share/gnome-shell/extensions/$UUID"
if [ ! -f "$ZIP" ] && [ ! -f "$INSTALLED/metadata.json" ]; then
    echo "Smart Calendar Hub not found: install it for your user first."
    exit 1
fi

# 1. the extension for all users
rm -rf "$DEST"
mkdir -p "$DEST"
if [ -f "$ZIP" ]; then
    unzip -q "$ZIP" -d "$DEST"
else
    # -L: the files themselves, not links to places the user can still change
    cp -rL "$INSTALLED/." "$DEST/"
fi
glib-compile-schemas "$DEST/schemas"
# the copy on extensions.gnome.org runs only in the session and on the lock
# screen; the login screen mode is added here, for this system copy only
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); m=d.setdefault("session-modes", ["user"]); "gdm" in m or m.append("gdm"); open(p,"w").write(json.dumps(d, indent=2, ensure_ascii=False)+"\n")' "$DEST/metadata.json"
chown -R root:root "$DEST"
chmod -R a+rX,go-w "$DEST"

# 2. your settings (dconf read works without a session bus); a key you
# never changed is empty: then the extension's default is used
# -H: HOME of that user, so dconf reads their database (not root's)
read_key() {
    local value
    value=$(sudo -H -u "$SUDO_USER" dconf read "$1" 2>/dev/null || true)
    echo "${value:-$2}"
}
if [ -z "$(sudo -H -u "$SUDO_USER" dconf read /org/gnome/desktop/interface/accent-color 2>/dev/null || true)" ]; then
    echo "Warning: cannot read the settings of $SUDO_USER (empty accent colour):"
    echo "using the default values."
fi
S=/org/gnome/shell/extensions/smart-calendar-hub
ACCENT_BAR=$(read_key "$S/accent-top-bar" "false")
TONE=$(read_key "$S/accent-top-bar-tone" "'light'")
SPACING=$(read_key "$S/top-bar-spacing" "12")
POSITION=$(read_key "$S/top-bar-position" "'right-between-tray-and-menu'")
ACCENT=$(read_key /org/gnome/desktop/interface/accent-color "'blue'")
BATTERY=$(read_key "$S/battery-circle" "false")
BATTERY_TEXT=$(read_key "$S/battery-circle-text" "true")

# 3. a system database for the gdm user (the default profile has none)
if [ ! -f "$PROFILE" ]; then
    cat > "$PROFILE" <<EOF
# added by smart-calendar-hub (install-login-screen.sh)
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
EOF
elif ! grep -q "^system-db:gdm" "$PROFILE"; then
    echo "Warning: $PROFILE already exists without 'system-db:gdm'."
    echo "Add the line 'system-db:gdm' after 'user-db:user' by hand."
fi
mkdir -p "$(dirname "$KEYFILE")"
# another keyfile may already choose the extensions of the login screen:
# ours would replace that list
OTHER=$(grep -l "enabled-extensions" "$(dirname "$KEYFILE")"/* 2>/dev/null | grep -v "$KEYFILE" || true)
if [ -n "$OTHER" ]; then
    echo "Warning: these files also choose the extensions of the login screen:"
    echo "$OTHER"
    echo "Our list replaces theirs: add their extensions to $KEYFILE by hand."
fi
cat > "$KEYFILE" <<EOF
# Smart Calendar Hub on the login screen (install-login-screen.sh)
[org/gnome/shell]
enabled-extensions=['$UUID']

[org/gnome/shell/extensions/smart-calendar-hub]
accent-top-bar=$ACCENT_BAR
accent-top-bar-tone=$TONE
top-bar-spacing=$SPACING
top-bar-position=$POSITION
battery-circle=$BATTERY
battery-circle-text=$BATTERY_TEXT

[org/gnome/desktop/interface]
accent-color=$ACCENT
EOF
dconf update

echo "Done. Settings brought to the login screen:"
echo "  accent colour in the top bar: $ACCENT_BAR (tone $TONE, accent $ACCENT)"
echo "  space between the icons: $SPACING   clock position: $POSITION"
echo "  battery as a circle: $BATTERY (percentage inside: $BATTERY_TEXT)"
echo "Visible after the next restart (or the next logout)."
