// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Translations of Smart Calendar Hub (same system as BlueHub).
// - Texts in the code are in English (base language), passed to _().
// - Italian is included below (table IT), which is also the complete list
//   of sentences.
// - Every other language is translated by users in
//   ~/.config/smart-calendar-hub/translations/<language>.json (e.g. fr.json).
//   The panel creates the file the first time and, after every
//   update, APPENDS only the new sentences at the end: translations already
//   written are never changed or removed. Empty sentences ("") stay in English.
// Words in braces, e.g. {app}, are replaced with real values and must be kept
// unchanged in translations too.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {logError} from './sch-log.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');

// Folder of the user translation files (follows XDG_CONFIG_HOME)
function translationsDir() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'smart-calendar-hub', 'translations']);
}

const README_KEY = '_README';
const README_TEXT =
    'Smart Calendar Hub translation file. Write your translation after each colon, between the quotes. ' +
    'Leave "" to keep the English text. Keep words in braces like {app} unchanged. ' +
    'New sentences from Smart Calendar Hub updates are added at the end automatically; ' +
    'your translations are never overwritten. ' +
    'Please share your finished file at https://github.com/bria-bria/smart-calendar-hub/issues';

// Italian: also the complete list of sentences (used for the users' files)
const IT = {
    // --- Side panel (sch-side-panel.js and its parts) ---
    "{app} (tray icon)":
        "{app} (icona del vassoio)",
    "Weather":
        "Meteo",
    "Sunrise and sunset":
        "Alba e tramonto",
    "Area around the banner (percent)":
        "Area intorno all'avviso (percentuale)",
    "How much larger than the notification the area the mouse must leave is: 0 = only the notification itself":
        "Quanto è più grande dell'avviso l'area da cui il mouse deve uscire: 0 = solo l'avviso stesso",
    "The whole day":
        "Tutta la giornata",
    // --- Settings, section "Extensions" (sch-settings-model.js) ---
    "Extensions":
        "Estensioni",
    "Orders the icons of the top bar.":
        "Mette in ordine le icone della barra in alto.",
    "Sunrise, sunset and day length. With it installed, a click on the sun and moon of the panel opens its menu inside the panel.":
        "Alba, tramonto e durata del giorno. Se è installata, un clic sul sole e la luna del pannello apre il suo menu dentro il pannello.",
    "Hide its icon in the top bar":
        "Nascondi la sua icona nella barra in alto",
    "Its menu still opens from the sun and moon of the panel":
        "Il suo menu si apre comunque dal sole e dalla luna del pannello",
    "Temperatures of the processor, the disks and the graphics card, and the fans.":
        "Temperature del processore, dei dischi e della scheda video, e le ventole.",
    // --- Vesperal in the card beside the panel (sch-ext-settings.js) ---
    "Close":
        "Chiudi",
    "In the top bar":
        "Nella barra in alto",
    "Sun arc and duration":
        "Arco del sole e durata",
    "Sun arc only":
        "Solo l'arco del sole",
    "Duration only":
        "Solo la durata",
    "Duration":
        "Durata",
    "Remaining time":
        "Tempo che manca",
    "Elapsed time":
        "Tempo passato",
    "Elapsed and remaining time":
        "Tempo passato e tempo che manca",
    "Until the next sunrise or sunset":
        "Alla prossima alba o al prossimo tramonto",
    "Since the last sunrise or sunset":
        "Dall'ultima alba o dall'ultimo tramonto",
    "Since the last sunrise or sunset, and until the next":
        "Dall'ultima alba o dall'ultimo tramonto, e quanto manca al prossimo evento",
    "Until the next dawn or dusk":
        "Alla prossima aurora o al prossimo crepuscolo",
    "Since the last dawn or dusk":
        "Dall'ultima aurora o dall'ultimo crepuscolo",
    "Since the last dawn or dusk, and until the next":
        "Dall'ultima aurora o dall'ultimo crepuscolo, e quanto manca al prossimo evento",
    "Dawn and dusk":
        "Aurora e crepuscolo",
    "Civil twilight (6°)":
        "Crepuscolo civile (6°)",
    "Nautical twilight (12°)":
        "Crepuscolo nautico (12°)",
    "Astronomical twilight (18°)":
        "Crepuscolo astronomico (18°)",
    "Arc of the sun":
        "Arco del sole",
    "Left of the duration":
        "A sinistra della durata",
    "Right of the duration":
        "A destra della durata",
    "Place of its icon":
        "Posto della sua icona",
    "Next to the clock":
        "Accanto all'orologio",
    "Left side":
        "Lato sinistro",
    "Right side":
        "Lato destro",
    "After the workspace indicator":
        "Dopo l'indicatore degli spazi di lavoro",
    "Before the system indicators":
        "Prima delle icone di sistema",
    "Day and night":
        "Giorno e notte",
    "From sunrise to sunset":
        "Dall'alba al tramonto",
    "From dawn to dusk":
        "Dall'aurora al crepuscolo",
    "As long as there is light, by the twilight chosen above":
        "Finché c'è la luce del crepuscolo scelto sopra",
    "Location":
        "Posizione",
    "From the location services":
        "Dai servizi di localizzazione",
    "Automatic":
        "Automatica",
    "Manual":
        "Manuale",
    "Location services are off":
        "I servizi di localizzazione sono spenti",
    "No location set":
        "Nessuna posizione scelta",
    "Search for a city":
        "Cerca una città",
    "Coordinates":
        "Coordinate",
    "Latitude (north positive)":
        "Latitudine (positiva a nord)",
    "Longitude (east positive)":
        "Longitudine (positiva a est)",
    "Latitude must be between −90 and 90":
        "La latitudine deve essere tra −90 e 90",
    "Longitude must be between −180 and 180":
        "La longitudine deve essere tra −180 e 180",
    "Send notifications":
        "Invia notifiche",
    "Dawn":
        "Aurora",
    "Sunrise":
        "Alba",
    "Sunset":
        "Tramonto",
    "Dusk":
        "Crepuscolo",
    "Notify ahead by":
        "Avvisa in anticipo di",
    "{minutes} min":
        "{minutes} min",
    "At the event":
        "Al momento dell'evento",
    // --- the year at a glance (sch-year-chart.js) ---
    "The year at a glance":
        "L'anno a colpo d'occhio",
    "No location yet: choose one above":
        "Ancora nessuna posizione: scegline una qui sopra",
    "{hours} h {minutes} min":
        "{hours} h {minutes} min",
    "In {days} days":
        "Tra {days} giorni",
    "March equinox":
        "Equinozio di marzo",
    "June solstice":
        "Solstizio di giugno",
    "September equinox":
        "Equinozio di settembre",
    "December solstice":
        "Solstizio di dicembre",
    // --- Freon in the card beside the panel (sch-ext-settings.js) ---
    "In the menu":
        "Nel menu",
    "Temperatures":
        "Temperature",
    "Fans":
        "Ventole",
    "Voltages":
        "Tensioni",
    "Power":
        "Potenza",
    "Grouped in a sub-menu":
        "Raggruppate in un sottomenu",
    "Unit":
        "Unità",
    "Celsius (°C)":
        "Celsius (°C)",
    "Fahrenheit (°F)":
        "Fahrenheit (°F)",
    "Decimal values":
        "Valori con decimali",
    "Sensor sources":
        "Fonti dei sensori",
    "Processor and motherboard":
        "Processore e scheda madre",
    "Disks":
        "Dischi",
    "Graphics card":
        "Scheda video",
    "Liquid coolers":
        "Raffreddamento a liquido",
    "Direct":
        "Diretto",
    "Icon":
        "Icona",
    "Temperature unit":
        "Unità della temperatura",
    "Fan speed unit":
        "Unità della velocità delle ventole",
    "Voltage unit":
        "Unità della tensione",
    "Power unit":
        "Unità della potenza",
    "Readings":
        "Letture",
    "Read the sensors every":
        "Leggi i sensori ogni",
    "{seconds} s":
        "{seconds} s",
    "Less":
        "Meno",
    "More":
        "Più",
    "One thermometer icon":
        "Una sola icona a termometro",
    "Its button shows one thermometer instead of an icon and a temperature for each sensor; the temperatures stay in its menu":
        "Il suo pulsante mostra un solo termometro invece di un'icona e una temperatura per ogni sensore; le temperature restano nel suo menu",
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
    "World clocks":
        "Orologi mondiali",
    "Previous city":
        "Città precedente",
    "Next city":
        "Città successiva",

    // --- IP addresses (sch-net.js, sch-settings-model.js) ---
    "IP addresses":
        "Indirizzi IP",
    "Refresh":
        "Aggiorna",
    "offline":
        "non connesso",
    "Local network: {ip}":
        "Rete locale: {ip}",
    "Public: {ip}":
        "Pubblico: {ip}",
    "VPN ({name}): {ip}":
        "VPN ({name}): {ip}",
    "VPN address":
        "Indirizzo della VPN",
    "Shown with a shield while a VPN such as Tailscale is active":
        "Compare con uno scudo quando è attiva una VPN come Tailscale",
    "Public: switched off in the settings":
        "Pubblico: spento nelle impostazioni",
    "Network":
        "Rete",
    "IP addresses in the top bar":
        "Indirizzi IP nella barra in alto",
    "Click the addresses in the top bar: the menu lists every address switched on here, click one to copy it.":
        "Clicca sugli indirizzi nella barra in alto: il menu elenca tutti gli indirizzi accesi qui, cliccane uno per copiarlo.",
    "IP addresses in the panel":
        "Indirizzi IP nel pannello",
    "A box under the tray icons. With more than one address, arrows go through them; click an address to copy it.":
        "Un riquadro sotto le icone del vassoio. Con più indirizzi le frecce li fanno scorrere; clicca un indirizzo per copiarlo.",
    "IP address in Smart Calendar Hub":
        "Indirizzo IP in Smart Calendar Hub",
    "Show the box in the side panel":
        "Mostra il riquadro nel pannello laterale",
    "Local network":
        "Rete locale",
    "The address on the network you are connected to now":
        "L'indirizzo nella rete a cui sei collegato adesso",
    "VPN":
        "VPN",
    "Every active one: VPN 1, 2, 3…":
        "Tutte quelle attive: VPN 1, 2, 3…",
    "Asks api.ipify.org, like the top bar":
        "Chiede ad api.ipify.org, come la barra in alto",
    "Space between the top bar icons (pixels)":
        "Spazio tra le icone della barra in alto (pixel)",
    "12 is the GNOME default; less brings the icons closer together":
        "12 è il valore di GNOME; meno avvicina le icone",
    "From GNOME Weather: set your cities there. In the panel, the up and down arrows go through them.":
        "Da GNOME Meteo: lì si impostano le città. Nel pannello le frecce su e giù le fanno scorrere.",
    "Weather in the top bar":
        "Meteo nella barra in alto",
    "Next to the clock, from GNOME Weather":
        "Accanto all'ora, da GNOME Meteo",
    "Icon and temperature":
        "Icona e temperatura",
    "Temperature only":
        "Solo temperatura",
    "Off":
        "Spento",
    "Position":
        "Posizione",
    "In the same pill as the clock, before or after the time":
        "Nella stessa pillola dell'ora, prima o dopo l'orario",
    "After the clock":
        "Dopo l'ora",
    "Before the clock":
        "Prima dell'ora",
    "Weather description":
        "Descrizione del meteo",
    "After each update, “Cloudy”, “Light rain”… for a few seconds instead of the temperature":
        "Dopo ogni aggiornamento, «Nuvoloso», «Pioggia debole»… per qualche secondo al posto della temperatura",
    "Date and sky":
        "Data e cielo",
    "The date, and next to it the sun and the moon. The two sky options can be used separately or together.":
        "La data e, accanto, il sole e la luna. Le due opzioni del cielo si possono usare da sole o insieme.",
    "Date":
        "Data",
    "Off: no date in the panel, and no sun or moon either":
        "Spento: niente data nel pannello, e niente sole e luna",
    "Banners away from the mouse":
        "Avvisi lontani dal mouse",
    "While the pointer is where a notification would pop up, it waits and appears as soon as the pointer moves away (urgent ones appear at once)":
        "Se il puntatore è dove apparirebbe una notifica, l'avviso aspetta e compare appena il puntatore si sposta (quelli urgenti compaiono subito)",
    "Today’s events":
        "Impegni di oggi",
    "A card with the events of the day above the notifications; click it to open the calendar beside the panel":
        "Una scheda con gli impegni del giorno sopra le notifiche; cliccala per aprire il calendario a fianco del pannello",
    "Align to GNOME’s menu":
        "Allinea al menu di GNOME",
    "As wide as the system menu (Wi-Fi, volume…), kept the same automatically":
        "Larga come il menu di sistema (Wi-Fi, volume…), tenuta uguale in automatico",
    "Calendar beside the panel":
        "Calendario a fianco del pannello",
    "When the panel opens again (it opens with a click on the “Today” card)":
        "Quando il pannello si riapre (si apre con un clic sulla scheda «Oggi»)",
    "Closed":
        "Chiuso",
    "As it was left":
        "Come l'avevi lasciato",
    "Open":
        "Aperto",
    "Accent colour in the top bar":
        "Colore d'accento nella barra in alto",
    "Texts and icons of the top bar in the accent colour chosen in GNOME Settings, and they follow it when it changes":
        "Scritte e icone della barra in alto nel colore d'accento scelto nelle Impostazioni di GNOME, e lo seguono quando cambia",
    "Tone of the accent colour":
        "Tonalità del colore d'accento",
    "Light: bright on the dark bar. Full: the colour of GNOME’s buttons, duller as text.":
        "Chiara: brillante sulla barra scura. Piena: il colore dei pulsanti di GNOME, più spento come testo.",
    "Light":
        "Chiara",
    "Full":
        "Piena",
    "Battery":
        "Batteria",
    "In the top bar, also on the lock screen and on the login screen.":
        "Nella barra in alto, anche sul blocco schermo e sulla schermata di accesso.",
    "Deminder’s extension, which gave us the idea of the circle, is drawing the battery: change its look in its own settings. Switch it off to get our circle back.":
        "L'estensione di Deminder, da cui viene l'idea del cerchio, sta disegnando la batteria: cambiane l'aspetto nelle sue impostazioni. Spegnila per riavere il nostro cerchio.",
    "Deminder’s extension, which gave us the idea of the circle, is installed but off. Turn it on and our circle steps aside.":
        "L'estensione di Deminder, da cui viene l'idea del cerchio, è installata ma spenta. Accendila e il nostro cerchio si fa da parte.",
    "Deminder’s extension, which gave us the idea of the circle: a circle or a portrait, in several styles. With it on, our circle steps aside.":
        "L'estensione di Deminder, da cui viene l'idea del cerchio: un cerchio o una pila verticale, in vari stili. Con lei accesa, il nostro cerchio si fa da parte.",
    "Project page":
        "Pagina del progetto",
    "Turn on":
        "Accendi",
    "Get it":
        "Installala",
    "GNOME did not turn it on: check that extensions are on in the Extensions app":
        "GNOME non l'ha accesa: controlla che le estensioni siano attive nell'app Estensioni",
    "The battery in the top bar as a circle or a portrait, by Deminder. While it is on, Smart Calendar Hub leaves the battery to it.":
        "La batteria nella barra in alto come cerchio o come pila verticale, di Deminder. Finché è accesa, Smart Calendar Hub lascia a lei la batteria.",
    "Battery as a circle":
        "Batteria circolare",
    "A ring that empties with the charge, in the colour of the bar; yellow under 20%, red under 10%. A bolt only while it is really charging":
        "Un anello che si svuota con la carica, nel colore della barra; giallo sotto il 20%, rosso sotto il 10%. Il fulmine solo quando sta davvero caricando",
    "Percentage inside the circle":
        "Percentuale dentro il cerchio",
    "Alarm · {name} · {time}":
        "Sveglia · {name} · {time}",
    "Alarm · {time}":
        "Sveglia · {time}",
    "Timer · {name} · {duration}":
        "Timer · {name} · {duration}",
    "Timer · {duration}":
        "Timer · {duration}",
    "Previous clocks":
        "Orologi precedenti",
    "Next clocks":
        "Orologi successivi",
    "By hand":
        "Da fare a mano",
    "What it uses":
        "Cosa usa",
    "Install them from your distribution or from GNOME Software.":
        "Installali dalla tua distribuzione o da GNOME Software.",
    "AppIndicator and KStatusNotifierItem Support":
        "AppIndicator and KStatusNotifierItem Support",
    "Extension: it creates the tray icons that Smart Calendar Hub moves into the panel. Keep it on.":
        "Estensione: crea le icone del vassoio che Smart Calendar Hub sposta nel pannello. Tienila accesa.",
    "GNOME Weather":
        "GNOME Meteo",
    "The weather and its cities: add your cities there.":
        "Il meteo e le sue città: aggiungi lì le tue città.",
    "GNOME Clocks":
        "GNOME Orologi",
    "World clocks, alarms and timers shown at the bottom of the panel: add them there.":
        "Orologi mondiali, sveglie e timer mostrati in fondo al pannello: aggiungili lì.",
    "GNOME Calendar":
        "GNOME Calendario",
    "“New event” and the calendars of your online accounts (GNOME Settings → Online Accounts).":
        "«Nuovo impegno» e i calendari dei tuoi account online (Impostazioni di GNOME → Account online).",
    "Extensions to switch off":
        "Estensioni da spegnere",
    "They do the same things: with both on, the top bar may show them twice or they fight over it.":
        "Fanno le stesse cose: con tutte e due accese la barra in alto può mostrarle due volte o se la contendono.",
    "Weather inside the clock pill: Panel → Weather.":
        "Meteo nella pillola dell'ora: Pannello → Meteo.",
    "Space between the top bar icons: Panel → Appearance.":
        "Spazio tra le icone della barra in alto: Pannello → Aspetto.",
    "Only its \"Items Color\": accent colour in the top bar, Panel → Appearance.":
        "Solo il suo «Items Color»: colore d'accento nella barra in alto, Pannello → Aspetto.",
    "Calendar reminders":
        "Promemoria del calendario",
    "On some systems the reminders of your events never show up: the service that sends them (evolution-alarm-notify) does not start in GNOME. These two commands start it at every login, without the option that stops it (the path of the service is taken from your system).":
        "Su alcuni sistemi i promemoria degli impegni non compaiono mai: il servizio che li manda (evolution-alarm-notify) in GNOME non parte. Questi due comandi lo avviano a ogni accesso, senza l'opzione che lo ferma (il percorso del servizio è preso dal tuo sistema).",
    "To undo it":
        "Per annullare",
    "1. In a terminal":
        "1. In un terminale",
    "2. Then":
        "2. Poi",
    "Copy the command":
        "Copia il comando",
    "Lock screen":
        "Blocco schermo",
    "Automatic: on the lock screen the top bar keeps the accent colour, the space between the icons, the clock position and the battery circle. The side panel, the notifications and the calendar are taken away while the screen is locked, so nothing personal shows.":
        "Automatico: sul blocco schermo la barra in alto tiene il colore d'accento, lo spazio tra le icone, la posizione dell'ora e la batteria circolare. Pannello laterale, notifiche e calendario vengono tolti mentre lo schermo è bloccato, così non si vede niente di personale.",
    "Login screen":
        "Schermata di accesso",
    "The screen where you choose the user belongs to the system: Smart Calendar Hub cannot change it by itself. A script, run by you in a terminal, installs the extension for all users and copies your accent colour, icon spacing, clock position and battery circle there.":
        "La schermata dove scegli l'utente è del sistema: Smart Calendar Hub non può cambiarla da sola. Uno script, lanciato da te in un terminale, installa l'estensione per tutti gli utenti e ci copia il tuo colore d'accento, lo spazio delle icone, la posizione dell'ora e la batteria circolare.",
    "It needs the administrator password":
        "Serve la password di amministratore",
    "It writes to /usr/share/gnome-shell/extensions and to /etc/dconf (settings of the gdm user). Read the script before running it.":
        "Scrive in /usr/share/gnome-shell/extensions e in /etc/dconf (impostazioni dell'utente gdm). Leggi lo script prima di lanciarlo.",
    "1. Download the script":
        "1. Scarica lo script",
    "It opens in the browser: save it with Ctrl+S in a folder of yours":
        "Si apre nel browser: salvalo con Ctrl+S in una tua cartella",
    "Open the page":
        "Apri la pagina",
    "2. In a terminal, in that folder":
        "2. In un terminale, in quella cartella",
    "3. Log out":
        "3. Esci dalla sessione",
    "The login screen shows the change. Run the script again after changing those settings or updating the extension.":
        "La schermata di accesso mostra la modifica. Rilancia lo script dopo aver cambiato quelle impostazioni o aggiornato l'estensione.",
    "Back to the login screen as it was":
        "Tornare alla schermata di accesso com'era",
    "In a terminal, in the folder of the script":
        "In un terminale, nella cartella dello script",
    "Off · click to switch it on in GNOME Clocks":
        "Spenta · clic per accenderla in GNOME Orologi",
    "Click: start":
        "Clic: avvia",
    "Finished · click: reset":
        "Finito · clic: azzera",
    "{left} left · click: pause · right click: reset":
        "Mancano {left} · clic: pausa · clic destro: azzera",
    "Paused · {left} left · click: resume · right click: reset":
        "In pausa · mancano {left} · clic: riprendi · clic destro: azzera",
    "Timer finished":
        "Timer finito",
    "Back":
        "Indietro",
    "Menu blended into the panel":
        "Menu integrato nel pannello",
    "On: the menu of the app sits directly on the panel, without a card around it, so it looks part of the panel.":
        "Acceso: il menu dell'app sta direttamente sul pannello, senza una scheda intorno, così sembra parte del pannello.",
    "Calendar and clocks under the menus":
        "Calendario e orologi sotto i menu",
    "On: under the menu of an app the calendar row, the world clocks with alarms and timers, and the bottom buttons stay visible, in the room the menu leaves free.":
        "Acceso: sotto il menu di un'app restano visibili la riga del calendario, gli orologi con sveglie e timer e i pulsanti in fondo, nello spazio che il menu lascia libero.",
    "Menus of the icons":
        "Menu delle icone",
    "Menus inside the panel":
        "Menu dentro il pannello",
    "Clicking a tray icon shows its menu inside the panel, in place of the cards, instead of a floating menu. Back with the arrow, Esc or another click on the icon.":
        "Il clic su un'icona del vassoio mostra il suo menu dentro il pannello, al posto delle schede, invece di un menu fluttuante. Si torna indietro con la freccia, con Esc o con un altro clic sull'icona.",
    "Menu inside the panel, icon by icon":
        "Menu dentro il pannello, icona per icona",
    "Switch off an icon to keep its menu floating (e.g. an app whose menu does not look right inside).":
        "Spegni un'icona per tenere il suo menu fluttuante (per esempio un'app il cui menu dentro non si vede bene).",
    "Previous icons":
        "Icone precedenti",
    "Next icons":
        "Icone successive",
    "All the addresses":
        "Tutti gli indirizzi",
    "Previous address":
        "Indirizzo precedente",
    "Next address":
        "Indirizzo successivo",
    "VPN {n}":
        "VPN {n}",
    "{name}: {ip} (click to copy)":
        "{name}: {ip} (clicca per copiare)",
    "Show in the top bar":
        "Mostra nella barra in alto",
    "Off: only in the menu that opens when you click the addresses":
        "Spento: solo nel menu che si apre cliccando sugli indirizzi",
    "Show the IP addresses":
        "Mostra gli indirizzi IP",
    "Position in the top bar":
        "Posizione nella barra in alto",
    "Left":
        "Sinistra",
    "Center":
        "Centro",
    "Right":
        "Destra",
    "Where the IP addresses appear":
        "Dove compaiono gli indirizzi IP",
    "Local network address":
        "Indirizzo della rete locale",
    "The address of this computer on the network it is connected to now":
        "L'indirizzo di questo computer nella rete a cui è collegato adesso",
    "Public address":
        "Indirizzo pubblico",
    "The address seen on the Internet. To know it, the extension asks api.ipify.org (when the network changes and every 30 minutes); that service sees the request.":
        "L'indirizzo visto su Internet. Per saperlo l'estensione lo chiede ad api.ipify.org (quando cambia la rete e ogni 30 minuti); quel servizio vede la richiesta.",

    // --- Silencing apps (sch-notifications.js, sch-settings-model.js) ---
    "Silence notifications from this app":
        "Silenzia le notifiche di questa app",
    "1 hour":
        "1 ora",
    "8 hours":
        "8 ore",
    "Until tomorrow":
        "Fino a domani",
    "Always":
        "Sempre",
    "Silenced apps":
        "App silenziate",
    "Silenced with the bell of a notification: no pop-up and no red dot; the notifications stay in the panel. Change or turn off the silence with the bell of the notification too.":
        "Silenziate con la campanella di una notifica: niente fumetto e niente puntino rosso; le notifiche restano nel pannello. Il silenzio si cambia o si toglie anche dalla stessa campanella.",
    "No silenced apps":
        "Nessuna app silenziata",
    "Until {time}":
        "Fino a {time}",
    "Unmute":
        "Riattiva",
    "Silenced until {time} · press the coloured button again to turn it back on":
        "Silenziata fino alle {time} · ripremi il tasto colorato per riattivarla",
    "Always silenced · press the coloured button again to turn it back on":
        "Silenziata sempre · ripremi il tasto colorato per riattivarla",

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

    // --- Calendars shown (sch-settings-model.js) ---
    "Tray":
        "Vassoio",
    "Calendars":
        "Calendari",
    "Notifications":
        "Notifiche",
    "Appearance":
        "Aspetto",
    "Sun and moon of the day":
        "Sole e luna del giorno",
    "The sun moves along an arc from sunrise to sunset, then the moon until the next sunrise":
        "Il sole percorre un arco dall'alba al tramonto, poi la luna fino all'alba successiva",
    "Moon phase":
        "Fase lunare",
    "The moon is drawn in its real phase; alone, it shows only the moon":
        "La luna è disegnata nella sua fase reale; da sola mostra solo la luna",
    "Calendars shown":
        "Calendari visualizzati",
    "Choose which calendars appear in the panel and in GNOME Calendar. This does not change your online accounts.":
        "Scegli quali calendari compaiono nel pannello e in GNOME Calendar. Gli account online non vengono modificati.",
    "No calendars found":
        "Nessun calendario trovato",
    "Calendars come from the online accounts in GNOME Settings":
        "I calendari arrivano dagli account online nelle Impostazioni di GNOME",

    // --- Settings (sch-settings-model.js, sch-hub-settings.js) ---
    "Tray icons need the “AppIndicator and KStatusNotifierItem Support” extension: turn it on":
        "Le icone del vassoio richiedono l'estensione «AppIndicator and KStatusNotifierItem Support»: attivala",
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
    "Right, next to the system menu":
        "A destra, accanto al menu di sistema",
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
    "A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon changes from the usual one (for example a badge with unread messages).":
        "Accanto all'ora compare un puntino rosso finché una delle app accese qui ha delle notifiche, o la sua icona del vassoio cambia rispetto al solito (per esempio un pallino con i messaggi non letti).",
    "No notifications seen yet":
        "Nessuna notifica vista per ora",
    "Apps appear here after they send a notification":
        "Le app compaiono qui dopo aver inviato una notifica",
    "Panel":
        "Pannello",
    "From top to bottom: tray icons (with the settings button), IP addresses, weather (collapsed at login), date, calendar, notifications, world clocks.":
        "Dall'alto in basso: icone del vassoio (con il pulsante delle impostazioni), indirizzi IP, meteo (chiuso al login), data, calendario, notifiche, orologi mondiali.",
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
function systemLanguage() {
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
// With merge=true (every time the panel starts) it creates the file if it
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
            logError(`translation file ${path} not valid, using English (file left untouched): ${e}`);
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
                logError(`cannot write translation file ${path}: ${e}`);
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
