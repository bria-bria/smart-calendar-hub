# Smart Calendar Hub

A GNOME Shell extension that turns the clock menu into a side panel.

From top to bottom the panel shows:

1. tray icons of applications (optional), with the button that opens the
   settings on their right,
2. weather, collapsed at login (it stays as you leave it until you log out),
3. today's date,
4. the calendar and events, collapsed by default,
5. GNOME's "Today" card with the events of the day (it can be switched off);
   a click opens the calendar in a card of its own next to the panel,
6. notifications,
7. world clocks as analogue clocks, in a card of their own always at the
   bottom (hover one for the city and time, arrows when they do not fit),
8. the bottom row: GNOME Clocks, New event, Clear.

It also shows the weather inside the clock pill (icon and temperature, before
or after the clock, with the description for a few seconds after each update;
unless another extension, such as Weather O'Clock, already does it) and lets
you move the clock to a different spot of the top bar.

## Every extension in one place

A click on an icon of the tray opens its menu **inside the panel**, in place
of the cards, instead of a floating menu: the panel keeps its size, the menu
takes the same measure as the rest (items, separators, section titles) and
the backgrounds of its containers become transparent. Back with the arrow,
Esc or another click on the icon. It can be switched off, for all icons or
icon by icon (Settings → Tray).

The other extensions need no change: Smart Calendar Hub takes their menu as
it is, and never modifies their code.

### Extensions we recommend

We like these extensions and recommend them alongside Smart Calendar Hub. We
tested each one inside the panel and tuned the hub until it looked right
there — always on our side: their code stays exactly as their authors wrote it.

| Extension | Inside the panel |
|---|---|
| [GSConnect](https://extensions.gnome.org/extension/1319/gsconnect/) (with "device indicators" on) | each phone with its battery, signal and actions |
| [WiFi Signal Plus](https://extensions.gnome.org/extension/9329/wifi-signal-plus/) | details of the Wi-Fi connection, signal graph, nearby networks |
| [AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/) | the tray icons of your apps and their menus, e.g. KTailctl (Tailscale) and Cachy-Update |

## Screenshots

![The side panel](screenshots/1-overview.png)
![The calendar open, with the agenda](screenshots/2-calendar.png)
![At night: the moon in its phase](screenshots/3-night.png)
![Preferences, in tabs](screenshots/4-prefs.png)

## Requirements

GNOME Shell 48, 49, 50 or 51. The weather comes from GNOME Weather: set a
location there to see the temperature.

Tray icons of applications are created by the
[AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/)
extension: keep it enabled. Smart Calendar Hub only moves those icons inside
the panel; the preferences window shows a warning when that extension is off.

## Settings

Open the preferences (Extensions app → Smart Calendar Hub) or click the gear
icon next to the tray icons. They are in five tabs:

- **Panel**: panel side (right, left, under the clock), clock position in the
  top bar, Top Bar Organizer sync (off by default; turn it on if you use Top
  Bar Organizer, otherwise both extensions try to place the clock), the date
  (it can be switched off, with the sun and the moon), the sky next to the date (sun and moon of the day, moon phase: each can be switched
  on alone), calendar collapsed on opening, panel width (or "Align to GNOME's
  menu": as wide as the system menu, automatically), space between the
  top bar icons (12 = GNOME default, less brings them closer), texts and
  icons of the top bar in GNOME's accent colour, the battery as a circle that
  empties with the charge (percentage inside optional).
- **Tray**: which top bar icons move inside the panel, and a switch for each
  app. The menu of a tray icon (e.g. a GSConnect device) opens inside the
  panel, in place of the cards, instead of floating; it can be switched off,
  for all icons or icon by icon.
- **Calendars**: which calendars are shown. This is the same switch GNOME
  Calendar uses, so a calendar turned off here is off there too (your online
  accounts are not changed). Calendars shared between two accounts appear once.
- **Notifications**: apps silenced with the bell of a notification (1 hour,
  8 hours, until tomorrow morning, always: no pop-up and no red dot, the
  notifications stay in the panel; press another duration to change it, the
  coloured one again or "Unmute" to undo) and the apps that
  light the red dot on the clock — for notifications, or when their tray icon
  changes from the usual one (e.g. an unread badge).
- **Network**: IP addresses in the top bar (left, center or right): local
  network, VPN and public address. Each one switched on is listed in the menu
  that opens when you click the addresses; open its row to choose whether it
  is shown in the bar too. **IP address in Smart Calendar Hub** adds a box
  under the tray icons with the chosen addresses (local network, every active
  VPN, public), shaped like the weather row, one at a time with arrows;
  click one to copy it.

- **By hand**: everything to be done outside the extension, with the
  commands to copy — the apps and extensions it uses, the extensions to switch
  off because they do the same things, calendar reminders that never show up,
  and the login screen script.

### Privacy and network use

Smart Calendar Hub asks for the public IP only if you switch on
**Public address** (off by default): it asks
`https://api.ipify.org` for your public IP address when the network changes
and every 30 minutes. That service sees the request.

When GNOME Weather has more than one city and you scroll to another city in
the panel, its weather is downloaded with GWeather from the same services
GNOME uses for the first city (MET Norway, airport METAR stations), at most
every 15 minutes while it is shown. Nothing else is sent
anywhere; calendars, notifications and settings stay on your computer.

## Lock screen and login screen

The look of the top bar (accent colour, space between the icons, clock
position) stays the same on the lock screen. Nothing else of the extension runs there: the side
panel, notifications, calendar and tray are taken down while the screen is
locked and built again when you unlock.

For the login screen (GDM), which belongs to the system, run once, and again
after changing those settings:

```bash
sudo ./installa-schermata-accesso.sh
```

It installs the extension for all users and copies your accent colour,
tone, icon spacing and clock position to the login screen.
`sudo ./installa-schermata-accesso.sh --rimuovi` takes it away.

## Install from source

```bash
./installa-smart-calendar-hub.sh
```

The script builds `dist/smart-calendar-hub@bria-bria.github.io.shell-extension.zip`,
installs it and enables it. On Wayland, log out and back in to load it.

## Translations

Smart Calendar Hub is written in **English** and includes **Italian**.
Any other language can be translated by you, without programming:

1. Open the Smart Calendar Hub settings once (Extensions app → Smart Calendar
   Hub, or the gear icon in the panel). The extension creates the file
   `~/.config/smart-calendar-hub/translations/<language>.json`
   for your system language (for example `fr.json`, `de.json`, `es.json`).
   The file lives outside the extension folder, so updates never remove it.
2. Open the file with a text editor. Each line is
   `"English sentence": "your translation"`. Write your translation between the
   second pair of quotes:

   ```json
   "Weather": "Météo",
   "Settings": "Paramètres",
   "Calendar and events": ""
   ```

   - Sentences left empty (`""`) are shown in English.
   - Keep the words in braces, such as `{app}` or `{temp}`, exactly as they are:
     Smart Calendar Hub replaces them with real values.
3. Save the file and open the settings again. The side panel picks up the new
   texts at the next login.

**Updates never delete your work.** When a new Smart Calendar Hub version adds
new sentences, they are appended at the end of your file with an empty
translation; everything you have already translated stays as it is.

If the file contains a mistake (for example a missing comma), Smart Calendar Hub
does not touch it, shows English and writes the error in the system log
(`journalctl --user -f`).

**Please share your translation**: open an
[issue](https://github.com/bria-bria/smart-calendar-hub/issues) and attach your
file, so it can be included for everyone in the next version.

For developers: every sentence is passed in English to `_()` in
`extension/sch-i18n.js`, with values as placeholders
(`_('{app} (tray icon)', {app: name})`), and must have its Italian translation
in the `IT` table of the same file. `strumenti/controlla-traduzioni.py` checks
this (the install script runs it).

## For extension developers

An extension with a top bar icon (`PanelMenu.Button`) already shows its menu
inside Smart Calendar Hub. It can also tell the hub how to show it, with an
optional property on its button — read only by the hub, so the extension
keeps working the same without it:

```js
this._button.smartCalendarHub = {
    // title above the menu (default: the name of the icon)
    title: 'My extension',
    // optional: a page of your own instead of the menu, built at every
    // visit and destroyed after it (free timers and signals on 'destroy')
    buildPage: () => new St.Label({text: 'Hello'}),
    // optional: true = the hub leaves your backgrounds alone
    keepStyle: false,
};
```

- The normal menu is still needed, with at least one item: it is what users
  without the hub see, and what the hub shows when there is no page.
- Inside the hub your menu box (or your page) carries the style class
  `sch-hub-page`, for styles that apply only there.
- A complete example is in [examples/hello-hub@bria-bria.github.io](examples/hello-hub@bria-bria.github.io).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
