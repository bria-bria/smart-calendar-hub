// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Translations of Smart Calendar Hub (same system as BlueHub).
// - Texts in the code are in English (base language), passed to _().
// - Italian is included below (table IT), which is also the complete list
//   of sentences.
// - Every other language is translated by users in
//   ~/.config/smart-calendar-hub/translations/<language>.json (e.g. fr.json).
//   The preferences window creates the file the first time and, after every
//   update, APPENDS only the new sentences at the end: translations already
//   written are never changed or removed. Empty sentences ("") stay in English.
// Words in braces, e.g. {app}, are replaced with real values and must be kept
// unchanged in translations too.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');

// Folder of the user translation files (follows XDG_CONFIG_HOME)
function translationsDir() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'smart-calendar-hub', 'translations']);
}

export const README_KEY = '_README';
const README_TEXT =
    'Smart Calendar Hub translation file. Write your translation after each colon, between the quotes. ' +
    'Leave "" to keep the English text. Keep words in braces like {app} unchanged. ' +
    'New sentences from Smart Calendar Hub updates are added at the end automatically; ' +
    'your translations are never overwritten. ' +
    'Please share your finished file at https://github.com/bria-bria/smart-calendar-hub/issues';

// Italian: also the complete list of sentences (used for the users' files)
export const IT = {
    // --- Side panel (extension.js) ---
    "{app} (tray icon)":
        "{app} (icona del vassoio)",
    "Weather":
        "Meteo",
    "Weather · {temp}° {place}":
        "Meteo · {temp}° {place}",
    "Settings":
        "Impostazioni",
    "Calendar and events":
        "Calendario ed eventi",
    "Notifications from: {apps}":
        "Notifiche da: {apps}",
    "New event":
        "Nuovo impegno",

    // --- Calendar (sch-calendar.js) ---
    "Today":
        "Oggi",
    "Previous month":
        "Mese precedente",
    "Next month":
        "Mese successivo",
    "1 event":
        "1 impegno",
    "{count} events":
        "{count} impegni",
    "No events":
        "Nessun impegno",
    "Tomorrow":
        "Domani",
    "All day":
        "Tutto il giorno",
    "(no title)":
        "(senza titolo)",

    // --- Calendars shown (prefs.js) ---
    "Tray":
        "Vassoio",
    "Calendars":
        "Calendari",
    "Notifications":
        "Notifiche",
    "Appearance":
        "Aspetto",
    "Calendars shown":
        "Calendari visualizzati",
    "Choose which calendars appear in the panel. This does not change your online accounts.":
        "Scegli quali calendari compaiono nel pannello. Gli account online non vengono modificati.",
    "No calendars found":
        "Nessun calendario trovato",
    "Calendars come from the online accounts in GNOME Settings":
        "I calendari arrivano dagli account online nelle Impostazioni di GNOME",

    // --- Preferences window (prefs.js) ---
    "Tray icons need the “AppIndicator and KStatusNotifierItem Support” extension: turn it on":
        "Le icone del vassoio richiedono l'estensione «AppIndicator and KStatusNotifierItem Support»: attivala",
    "Position":
        "Posizione",
    "Where the side panel opens and where the clock sits in the top bar.":
        "Dove si apre il pannello laterale e dove sta l'ora nella barra in alto.",
    "Panel side":
        "Lato del pannello",
    "Side of the screen where the panel appears when you click the clock":
        "Lato dello schermo in cui compare il pannello quando clicchi sull'ora",
    "Right edge of the screen":
        "Bordo destro dello schermo",
    "Left edge of the screen":
        "Bordo sinistro dello schermo",
    "Under the clock button":
        "Sotto il pulsante dell'ora",
    "Clock in the top bar":
        "Ora nella barra in alto",
    "Position of the clock and temperature in the GNOME top bar":
        "Posizione di ora e temperatura nella barra in alto di GNOME",
    "Right, between tray icons and system menu":
        "A destra, tra le icone del vassoio e il menu di sistema",
    "Right, before tray icons":
        "A destra, prima delle icone del vassoio",
    "Left, after the menus":
        "A sinistra, dopo i menu",
    "Center (GNOME default)":
        "Al centro (predefinito di GNOME)",
    "Icons inside the panel":
        "Icone dentro il pannello",
    "Top bar icons moved to the top of the panel":
        "Icone della barra in alto spostate in cima al pannello",
    "Tray icons of applications":
        "Icone del vassoio delle applicazioni",
    "All icons on the right side":
        "Tutte le icone del lato destro",
    "None, leave them in the top bar":
        "Nessuna, lasciale nella barra in alto",
    "Apps inside the panel":
        "App dentro il pannello",
    "Choose, among the icons present now, which ones move inside the panel and which stay in the top bar.":
        "Scegli, tra le icone presenti adesso, quali vanno dentro il pannello e quali restano nella barra in alto.",
    "No icons found yet":
        "Nessuna icona trovata per ora",
    "Open the panel once: the list fills in by itself":
        "Apri il pannello una volta: l'elenco si riempie da solo",
    "Keep Top Bar Organizer in sync":
        "Sincronizza con Top Bar Organizer",
    "Also writes the clock position into the Top Bar Organizer extension settings; the previous order is restored when Smart Calendar Hub is turned off":
        "Scrive la posizione dell'ora anche nelle impostazioni dell'estensione Top Bar Organizer; l'ordine precedente viene ripristinato quando Smart Calendar Hub viene spenta",
    "Red dot on the clock":
        "Puntino rosso sull'ora",
    "A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon signals something new (only for apps that report it, e.g. Telegram).":
        "Accanto all'ora compare un puntino rosso finché una delle app accese qui ha delle notifiche, o la sua icona del vassoio segnala una novità (solo per le app che lo comunicano, per esempio Telegram).",
    "No notifications seen yet":
        "Nessuna notifica vista per ora",
    "Apps appear here after they send a notification":
        "Le app compaiono qui dopo aver inviato una notifica",
    "Panel":
        "Pannello",
    "From top to bottom: tray icons, weather (collapsed at login, with the settings button), date, calendar, notifications, world clocks.":
        "Dall'alto in basso: icone del vassoio, meteo (chiuso al login, con il pulsante delle impostazioni), data, calendario, notifiche, orologi mondiali.",
    "Calendar collapsed on opening":
        "Calendario chiuso all'apertura",
    "Click “Calendar and events” to open it":
        "Clicca su «Calendario ed eventi» per aprirlo",
    "Panel width (pixels)":
        "Larghezza del pannello (pixel)",
};

// Translations read from the user's file (languages other than it/en); null = none
let userTable = null;
// Incremented by unloadUserTranslations(): a load still running when the
// extension is disabled must not fill the tables again.
let generation = 0;
// System language, computed at the first translation (reset in unload)
let cachedLanguage = null;

// Code of the system language, e.g. 'it', 'en', 'fr'
export function systemLanguage() {
    for (const name of GLib.get_language_names()) {
        if (name !== 'C' && name !== 'POSIX')
            return name.split(/[_.@]/)[0].toLowerCase();
    }
    return 'en';
}

// Translates an English sentence and replaces {name} with params.name
export function _(text, params = {}) {
    cachedLanguage ??= systemLanguage();
    const lang = cachedLanguage;
    let s = null;
    if (lang === 'it')
        s = IT[text];
    else if (lang !== 'en')
        s = userTable?.[text];
    if (typeof s !== 'string' || s === '')
        s = text;
    return s.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(params, key) ? String(params[key]) : match));
}

async function ensureDir(path) {
    const dir = Gio.File.new_for_path(path);
    try {
        await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            return;
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            throw e;
        await ensureDir(GLib.path_get_dirname(path)); // create the parent first
        await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    }
}

// Loads the user's translation file for the system language.
// With merge=true (used by the preferences window) it creates the file if it
// is missing and appends the new sentences at the end, never changing the
// ones already there. If the file contains a mistake it is left untouched and
// English is used. Returns the file path, or null for Italian/English.
export async function loadUserTranslations({merge = false} = {}) {
    const myGeneration = generation;
    const lang = systemLanguage();
    cachedLanguage = lang;
    if (lang === 'it' || lang === 'en') {
        userTable = null;
        return null;
    }
    const dir = translationsDir();
    const path = GLib.build_filenamev([dir, `${lang}.json`]);
    const file = Gio.File.new_for_path(path);

    let existing = null;
    try {
        const [contents] = await file.load_contents_async(null);
        existing = JSON.parse(new TextDecoder().decode(contents));
        if (!existing || typeof existing !== 'object' || Array.isArray(existing))
            throw new Error('the file must contain a JSON object { "English": "translation" }');
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            console.error(`Smart Calendar Hub: translation file ${path} not valid, using English (file left untouched): ${e}`);
            if (myGeneration === generation)
                userTable = null;
            return path;
        }
    }

    if (merge) {
        const missing = Object.keys(IT).filter(k => !(existing && k in existing));
        if (existing === null || missing.length > 0) {
            // New keys are added after the existing ones, so they end up at the end
            const updated = existing ?? {[README_KEY]: README_TEXT};
            for (const key of missing)
                updated[key] = '';
            try {
                await ensureDir(dir);
                const data = new TextEncoder().encode(`${JSON.stringify(updated, null, 2)}\n`);
                await file.replace_contents_async(data, null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                existing = updated;
            } catch (e) {
                console.error(`Smart Calendar Hub: cannot write translation file ${path}: ${e}`);
            }
        }
    }

    if (myGeneration !== generation)
        return path; // disabled meanwhile
    userTable = {};
    for (const [key, value] of Object.entries(existing ?? {})) {
        if (key !== README_KEY && typeof value === 'string' && value !== '')
            userTable[key] = value;
    }
    return path;
}

// Call in disable(): frees the loaded translations
export function unloadUserTranslations() {
    generation++;
    userTable = null;
    cachedLanguage = null;
}
