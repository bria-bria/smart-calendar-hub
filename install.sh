#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
#
# Guided installer for Smart Calendar Hub, for people who don't want to type
# commands. Download it from the latest release, read it if you like, then:
#
#   bash install.sh              install or update
#   bash install.sh --uninstall  remove it
#
# It checks your GNOME version, takes the extension zip (next to this file,
# or the latest release on GitHub), checks it, installs it, turns it on and
# can also bring the top bar look to the login screen (asks first; only
# that step uses sudo). Nothing is sent anywhere.

set -euo pipefail

UUID=smart-calendar-hub@bria-bria.github.io
REPO=bria-bria/smart-calendar-hub
ZIP_NAME="$UUID.shell-extension.zip"
LOGIN_SCRIPT=install-login-screen.sh
RELEASE_URL="https://github.com/$REPO/releases/latest/download"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Messages in Italian when the system is in Italian, English otherwise
if [[ "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" == it* ]]; then IT=1; else IT=0; fi
say() { if [[ $IT == 1 ]]; then echo "$2"; else echo "$1"; fi; }
step() { echo; say "▶ $1" "▶ $2"; }
fail() { echo; say "✖ $1" "✖ $2" >&2; exit 1; }
ask() { # ask "question" "domanda" → 0 for yes
    local answer
    if [[ $IT == 1 ]]; then read -r -p "$2 [s/N] " answer; else read -r -p "$1 [y/N] " answer; fi
    [[ "$answer" =~ ^[yYsS] ]]
}

if [[ $EUID -eq 0 ]]; then
    fail "Run it as yourself, without sudo: the extension is installed for your user." \
         "Lancialo come utente normale, senza sudo: l'estensione si installa per il tuo utente."
fi

for tool in gnome-shell gnome-extensions unzip; do
    command -v "$tool" >/dev/null ||
        fail "'$tool' is missing: this installer needs GNOME Shell and unzip." \
             "Manca '$tool': servono GNOME Shell e unzip."
done

WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT

# download URL → FILE; false if it did not work
download() {
    if command -v curl >/dev/null; then
        curl -fL --progress-bar -o "$2" "$1"
    elif command -v wget >/dev/null; then
        wget -q --show-progress -O "$2" "$1"
    else
        say "Neither curl nor wget is installed." "Non ci sono né curl né wget."
        return 1
    fi
}

# The login screen script, next to this file or from the latest release.
# It runs with sudo, so the user can read it before saying yes.
# Prints its path, or nothing if it could not be found.
login_script() {
    local script="$HERE/$LOGIN_SCRIPT"
    if [[ ! -f "$script" ]]; then
        script="$WORK/$LOGIN_SCRIPT"
        download "$RELEASE_URL/$LOGIN_SCRIPT" "$script" >&2 || return 0
    fi
    # called as $(login_script): stdout is the result, so the text goes to stderr
    if ask "It runs with your password (sudo). Read it first?" \
           "Si esegue con la tua password (sudo). Vuoi leggerlo prima?"; then
        "${PAGER:-less}" "$script" >&2 || cat "$script" >&2
        ask "Run it?" "Lo eseguo?" || return 0
    fi
    echo "$script"
}

# --- Uninstall ---
if [[ "${1:-}" == "--uninstall" ]]; then
    step "Removing Smart Calendar Hub" "Tolgo Smart Calendar Hub"
    gnome-extensions disable "$UUID" 2>/dev/null || true
    gnome-extensions uninstall "$UUID" 2>/dev/null ||
        rm -rf -- "$HOME/.local/share/gnome-shell/extensions/$UUID"
    if [[ -d "/usr/share/gnome-shell/extensions/$UUID" ]] &&
        ask "It is also on the login screen: remove it from there too?" \
            "È anche sulla schermata di accesso: la tolgo anche da lì?"; then
        SCRIPT=$(login_script)
        if [[ -n "$SCRIPT" ]]; then
            sudo bash "$SCRIPT" --remove
        else
            say "Skipped: the login screen keeps it." "Saltato: la schermata di accesso la tiene."
        fi
    fi
    say "Done. Log out and back in to finish." "Fatto. Fai logout e login per finire."
    exit 0
fi

say "Smart Calendar Hub — guided install" "Smart Calendar Hub — installazione guidata"

# --- 1. GNOME version ---
step "Checking your GNOME version" "Controllo la versione di GNOME"
GNOME_VERSION=$(gnome-shell --version | grep -oE '[0-9]+' | head -n1)
say "GNOME Shell $GNOME_VERSION" "GNOME Shell $GNOME_VERSION"

# --- 2. The zip ---
if [[ -f "$HERE/$ZIP_NAME" ]]; then
    step "Using the zip next to this file" "Uso lo zip accanto a questo file"
    ZIP="$HERE/$ZIP_NAME"
else
    step "Downloading the latest release from GitHub" "Scarico l'ultima versione da GitHub"
    ZIP="$WORK/$ZIP_NAME"
    download "$RELEASE_URL/$ZIP_NAME" "$ZIP" ||
        fail "Download failed. Check the connection, or download $ZIP_NAME from https://github.com/$REPO/releases and put it next to this file." \
             "Download non riuscito. Controlla la connessione, o scarica $ZIP_NAME da https://github.com/$REPO/releases e mettilo accanto a questo file."
fi

# --- 3. Check the zip ---
step "Checking the zip" "Controllo lo zip"
unzip -tq "$ZIP" >/dev/null ||
    fail "The zip is damaged: download it again." "Lo zip è rovinato: scaricalo di nuovo."
METADATA=$(unzip -p "$ZIP" metadata.json 2>/dev/null) ||
    fail "This zip is not a GNOME extension." "Questo zip non è un'estensione GNOME."
[[ "$METADATA" == *"\"$UUID\""* ]] ||
    fail "This zip is not Smart Calendar Hub." "Questo zip non è Smart Calendar Hub."
# the versions listed in "shell-version"
SUPPORTED=$(tr -d '\n' <<<"$METADATA" | grep -oE '"shell-version"[^]]*' | grep -oE '[0-9]+' | tr '\n' ' ')
if [[ " $SUPPORTED" != *" $GNOME_VERSION "* ]]; then
    say "Warning: this version supports GNOME $SUPPORTED— you have GNOME $GNOME_VERSION. It may not work." \
        "Attenzione: questa versione funziona con GNOME $SUPPORTED— tu hai GNOME $GNOME_VERSION. Potrebbe non funzionare."
    ask "Install anyway?" "La installo lo stesso?" || exit 1
fi
say "OK" "OK"

# --- 4. Install and turn on ---
step "Installing" "Installo"
# (it also compiles the settings schema, since GNOME 44)
gnome-extensions install --force "$ZIP"
step "Turning it on" "La attivo"
# The "Use Extensions" switch of the Extensions app turns off every extension
if [[ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" == "true" ]]; then
    say "All extensions are switched off (\"Use Extensions\" in the Extensions app)." \
        "Tutte le estensioni sono spente (\"Usa estensioni\" nell'app Estensioni)."
    if ask "Switch extensions back on?" "Le riaccendo?"; then
        gsettings set org.gnome.shell disable-user-extensions false
    fi
fi
# On Wayland GNOME sees a new extension only after logging in again,
# so it is written straight into the list of enabled extensions
if ! gnome-extensions enable "$UUID" 2>/dev/null; then
    CURRENT=$(gsettings get org.gnome.shell enabled-extensions)
    if [[ "$CURRENT" != *"'$UUID'"* ]]; then
        if [[ "$CURRENT" == "@as []" || "$CURRENT" == "[]" ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${CURRENT%]}, '$UUID']"
        fi
    fi
fi
say "OK" "OK"

# --- 5. Login screen (optional) ---
echo
say "Optional: the login screen can show the same top bar look (accent colour, icon spacing, clock position)." \
    "Facoltativo: la schermata di accesso può avere lo stesso aspetto della barra (colore d'accento, spazio tra le icone, posizione dell'ora)."
say "This needs your password (sudo), because the login screen belongs to the system." \
    "Serve la tua password (sudo), perché la schermata di accesso è del sistema."
if ask "Set up the login screen too?" "Lo faccio anche per la schermata di accesso?"; then
    SCRIPT=$(login_script)
    if [[ -n "$SCRIPT" ]]; then
        # it copies the extension just installed for your user
        sudo bash "$SCRIPT" || say "The login screen step did not finish: the extension is installed anyway." \
                                    "La parte della schermata di accesso non è finita: l'estensione è installata lo stesso."
    else
        say "Skipped: you can do it later by running this installer again." \
            "Saltato: puoi farlo dopo rilanciando questo installer."
    fi
fi

# --- Done ---
echo
say "✔ Smart Calendar Hub is installed." "✔ Smart Calendar Hub è installata."
say "  1. Log out and log back in (GNOME loads new extensions only then)." \
    "  1. Fai logout e poi login (GNOME carica le estensioni nuove solo così)."
say "  2. Click the clock in the top bar: the side panel opens." \
    "  2. Clicca l'ora nella barra in alto: si apre il pannello laterale."
say "  3. Settings: the gear button in the panel, next to the tray icons." \
    "  3. Impostazioni: la rotella nel pannello, accanto alle icone del vassoio."
say "  To update later, run this installer again. To remove it: bash install.sh --uninstall" \
    "  Per aggiornarla, rilancia questo installer. Per toglierla: bash install.sh --uninstall"
