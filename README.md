# Smart Calendar Hub

A GNOME Shell extension that turns the clock menu into a side panel.

**Website: https://bria-bria.github.io/smart-calendar-hub/**

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

| Extension | How the hub works with it |
|---|---|
| [WiFi Signal Plus](https://extensions.gnome.org/extension/9329/wifi-signal-plus/) | details of the Wi-Fi connection, signal graph, nearby networks |
| [AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/) | the tray icons of your apps and their menus, e.g. KTailctl (Tailscale) and Cachy-Update |
| [Top Bar Organizer](https://extensions.gnome.org/extension/4356/top-bar-organizer/) | with one switch, the clock position is written into its order so the two never fight (the old order comes back when switched off); the tray keeps its icons when it re-sorts them |

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
  app. The menu of a tray icon (e.g. Cachy-Update) opens inside the
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

### Open a page without a tray icon

An extension with no top bar icon (for example one that lives in the Quick
Settings menu) can open a page of its own in the hub's panel:

```js
const hub = Main.extensionManager.lookup('smart-calendar-hub@bria-bria.github.io');
const shown = hub?.stateObj?.showExternalPage?.({
    id: 'my-extension',          // the same id while open: nothing changes
    title: 'My extension',       // title above the page
    buildPage: () => new St.Label({text: 'Hello'}),
    keepStyle: false,            // true: the hub leaves your backgrounds alone
    // optional: a second page in a card beside the panel (where the
    // calendar opens), for long lists; it scrolls by itself
    buildSidePage: () => new St.Label({text: 'More room here'}),
}) ?? false;
if (!shown)
    this.openPreferences();      // your own fallback
```

- The panel opens on your page, in the same card as the tray menus: back
  arrow, Esc, or closing the panel end the visit, and the page is destroyed
  then (free timers and signals on its `destroy`).
- It returns `false` when the hub is not installed, switched off, on the lock
  screen, or when `buildPage` throws or returns an actor that already has a
  parent: keep a fallback of your own.
- Nothing to register: one call, the hub owns the page while it is shown.
- `buildSidePage` is optional: if it throws or returns an invalid actor the
  main page is shown alone. The calendar beside the panel steps aside for the
  visit and comes back after it. Both pages are destroyed together.
- `hub.stateObj.externalPageFeatures` (read only) lists what this version
  supports beyond the main page: `['side']` means `buildSidePage`.

### Page model

Pages shown in the hub follow one model, so every extension looks like part
of the panel:

1. **The header is the hub's**: back arrow and title. Never draw your own.
2. **Section titles** small and grey, above groups of rows.
3. **Rows**, all alike, inside rounded cards: icon, title, one line of detail,
   and on the right one thing only — a switch, a value or a chevron.
4. **Pill buttons**, and **one** primary (accent colour) button per page.
5. **The card beside the panel** is the calendar's card: same width, height
   and alignment, which you cannot change. Use it only for long lists or
   details. Its header is drawn by the hub like the calendar's month header:
   `sideTitle`, an optional `sideCount`, at most two round `sideActions`
   (`{icon, label, onClick}`).
6. **Scrolling is the hub's**, in the column and in the side card.
7. **Empty state**: an icon and one sentence.

Only theme colours and GNOME's accent colour, no backgrounds of your own, no
windows or menus popping out of the panel.

The **page kit** gives you these pieces ready made, with the look of the
panel; if the look changes, your page follows:

```js
const hubState = Main.extensionManager.lookup('smart-calendar-hub@bria-bria.github.io')?.stateObj;
const kit = hubState?.pageKit;   // check hubState.externalPageFeatures includes 'kit'

const page = kit.page(
    kit.section('Shared audio'),
    kit.card(
        kit.row({icon: 'audio-headphones-symbolic', title: 'Headphones', subtitle: 'Connected · 80%',
            trailing: kit.toggle({active: true, onToggle: on => console.log(on)})}),
        kit.row({icon: 'input-gaming-symbolic', title: 'Gamepad', subtitle: 'Not connected',
            trailing: kit.chevron(), onActivate: () => console.log('open')}),
    ),
    kit.buttons(
        kit.button({label: 'Search devices', primary: true, onClick: () => console.log('search')}),
        kit.button({label: 'Settings', onClick: () => console.log('settings')}),
    ),
);
// nothing to list: kit.empty({icon: 'bluetooth-disabled-symbolic', text: 'No other devices'})
```

Pieces: `page`, `section`, `card`, `row`, `toggle`, `value`, `chevron`,
`button`, `buttons`, `empty` (`kit.version` = 1).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
