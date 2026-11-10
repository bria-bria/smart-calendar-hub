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
you move the clock to a different spot in the top bar.

## Why Smart Calendar Hub

Smart Calendar Hub didn’t happen overnight. It grew out of two decades of
daily use: Michele has been working with Linux and GNOME since 2005, and
firmly regards GNOME as the cleanest, most reliable, and best-architected
desktop on Linux.

The vision was to take that design philosophy one step further. Most
extension developers naturally concentrate on the Quick Settings menu or add
standalone icons to the top panel. Yet the central panel — the Calendar &
Notification menu — has always been a prime, focused canvas with immense
untapped potential.

Smart Calendar Hub turns this central space into an organized productivity hub:

- **Clean and clutter-free**: everything you need in one predictable, unified location.
- **Thoughtful integration**: designed to respect GNOME’s native aesthetic while unlocking faster day-to-day workflows.
- **Friendly to the ecosystem**: a structured foundation not just for daily users, but an elegant host for future extension integrations.

It’s not about changing GNOME — it’s about giving its most central panel the
purpose and dynamism it deserves.

## Every extension in one place

A click on a tray icon opens its menu **inside the panel**, in place
of the cards, instead of a floating menu: the panel keeps its size, the menu
uses the same sizes as the rest (items, separators, section titles) and
the backgrounds of its containers become transparent. Go back with the arrow,
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
| [Vesperal](https://extensions.gnome.org/extension/11329/vesperal/) | tells time by the Sun: a click on the hub's sun and moon opens its menu inside the panel, all its settings open in the card beside the panel (from version 4 also the top bar content, the day from dawn to dusk and the notifications; with an offline city search and the year at a glance: day length through the year, solstices and equinoxes), and its own icon next to the clock can be hidden |
| [Battery Indicator Icon](https://extensions.gnome.org/extension/5718/battery-indicator-icon/) | by Deminder, where the idea of our battery circle comes from ([project](https://github.com/Deminder/battery-indicator-icon)): while it is on, the hub's own circle steps aside and lets it draw the battery, also on the lock screen |
| [Freon](https://extensions.gnome.org/extension/841/freon/) | temperatures of the processor, disks and graphics card, and fan speeds: its menu opens in the panel, its "Sensor Settings" item opens all its settings (what the menu and the top bar show, grouping, unit, polling interval, sensor sources) in the card beside the panel, the mouse wheel scrolls its long sensor lists, and an optional switch shows one thermometer in the tray instead of a reading per sensor |

### System updates

With [Octopi](https://tintaescura.com/projects/octopi/) in the tray (Arch,
CachyOS), a click on its icon opens its menu in the panel and, in the card
beside it, **System updates**: how many updates there are for the system
packages, the Flatpak apps and the firmware, with the first names of each.
On systems without Octopi (Fedora, Ubuntu…) the same page is in Settings,
after the sections. When no update program has a tray icon of its own (e.g.
Ubuntu or Debian with only GNOME Software), a button next to the gear shows
the number of updates, only while there are some, and opens the same page;
it checks when the panel opens, at most once an hour (Settings → Tray →
System updates). It only counts: **Update with Octopi** (or Cachy-Update, or
Ubuntu's Software Updater) and **Open GNOME Software** open the program that
installs them. **Update in terminal** (an idea of
[@simonezubbi](https://github.com/simonezubbi)) opens your terminal with the
update commands of your system (`sudo pacman -Syu`, `sudo dnf upgrade`,
`sudo apt update && sudo apt upgrade`, `sudo zypper update` (`dist-upgrade`
on Tumbleweed) or `rpm-ostree upgrade` on Silverblue, then `snap refresh`
and `flatpak update` if you have them; `su -c` where there is no `sudo`): they run only after you read them and press Enter, and
the window stays open until you press Enter again. The counts come from `checkupdates` (pacman-contrib) on Arch,
PackageKit elsewhere, `snap`, `flatpak` and fwupd; nothing runs as root and
no package manager runs inside GNOME Shell.

### Built for the hub

[BlueHub](https://github.com/bria-bria/bluehub),
our other extension, manages several Bluetooth devices at once and lives
entirely inside the panel when Smart Calendar Hub is installed: its controls
in the column, its device lists in the card beside it, built with the page
kit. Without the hub it opens its own settings window.

## Screenshots

![The side panel](screenshots/1-overview.png)
![The calendar open, with the agenda](screenshots/2-calendar.png)
![At night: the moon in its phase](screenshots/3-night.png)

## Requirements

GNOME Shell 48, 49, 50 or 51. The weather comes from GNOME Weather: set a
location there to see the temperature.

Tray icons of applications are created by the
[AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/)
extension: keep it enabled. Smart Calendar Hub only moves those icons inside
the panel; its settings (Tray section) show a warning when that extension is off.

## Settings

All the settings live in the panel itself: click the gear icon next to
the tray icons and they open in the card beside the panel, in the style of
the panel, with the list of sections; click one to see its settings, and the
arrow in the header takes you back to the list. Every change is applied at once.
There is no separate preferences window (the Extensions app shows no
settings button). The seven sections:

- **Panel**: panel side (right, left, under the clock), clock position in the
  top bar, the date
  (it can be switched off, with the sun and the moon), the sky next to the date (sun and moon of the day, moon phase: each can be switched
  on alone), calendar collapsed on opening, panel width (or "Align to GNOME's
  menu": as wide as the system menu, automatically), space between the
  top bar icons (12 = GNOME default, less brings them closer), texts and
  icons of the top bar in GNOME's accent colour, the battery as a circle that
  empties with the charge (percentage inside optional) — the idea of
  [battery-indicator-icon](https://github.com/Deminder/battery-indicator-icon) by Deminder: while that extension
  is on, the hub leaves the battery to it and these two switches give way to
  a row that says so.
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
  click one to copy it. **Check for new versions** (on by default): see
  *Privacy and network use*.
- **Extensions**: settings for the other extensions the hub works with, used
  only when they are installed. Top Bar Organizer sync (off by default; turn
  it on if you use Top Bar Organizer, otherwise both extensions try to place
  the clock). Vesperal: a click on the sun and moon opens its menu inside the
  panel (its "Preferences" and "Set a location manually…" items open all
  its settings in the card beside the panel), and its own icon next to the clock can be hidden. Freon: one
  thermometer icon instead of an icon and a temperature for each sensor.
  Battery Indicator Icon: whether it is on, with a button to turn it on if it
  is installed, or to get it from extensions.gnome.org.
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
every 15 minutes while it is shown. When you open **System updates** (at
most every 10 minutes, or on **Check again**), `checkupdates` and `flatpak`
ask your package mirrors and Flatpak remotes for their lists of updates, as
the update programs do; PackageKit and fwupd only answer from what they
already know.

**Check for new versions** (Settings → Network, on by default): when you
open the list of the settings, at most once a day, the extension makes one
request, `GET https://api.github.com/repos/bria-bria/smart-calendar-hub/releases/latest`,
with the generic User-Agent `Smart-Calendar-Hub` and nothing about you. If
a newer release is out, the bottom of the list shows it, with **What's new**
(its page) and **Update**, which downloads that release's zip from this
repository and installs it with `gnome-extensions install --force`; the new
version starts at your next login. Otherwise the bottom of the list shows
your version. Switch it off and no request is made.

Nothing else is sent
anywhere; calendars, notifications and settings stay on your computer.

## Lock screen and login screen

The look of the top bar (accent colour, space between the icons, clock
position) stays the same on the lock screen. No other part of the extension runs there: the side
panel, notifications, calendar and tray are taken down while the screen is
locked and built again when you unlock.

For the login screen (GDM), which belongs to the system, run once, and again
after changing those settings:

```bash
sudo ./install-login-screen.sh
```

It installs the extension for all users and copies your accent colour,
tone, icon spacing and clock position to the login screen.
`sudo ./install-login-screen.sh --remove` takes it away.

## Install

Smart Calendar Hub is distributed here on GitHub. Choose one of two ways.

### Guided installer (easiest)

1. Download `install.sh` from the [latest release](https://github.com/bria-bria/smart-calendar-hub/releases/latest).
   You can open it with a text editor and read what it does first.
2. Run it:
   ```bash
   bash install.sh
   ```

It checks your GNOME version, downloads the latest version of the extension
(or uses the zip if you put it next to `install.sh`), checks the file,
installs it and turns it on. It can also give the login screen the same
top bar look: it asks first, and only that step needs your password.
Run it again to update; `bash install.sh --uninstall` removes it.

### By hand

1. Download `smart-calendar-hub@bria-bria.github.io.shell-extension.zip`
   from the [latest release](https://github.com/bria-bria/smart-calendar-hub/releases/latest).
2. Install it:
   ```bash
   gnome-extensions install --force smart-calendar-hub@bria-bria.github.io.shell-extension.zip
   ```
3. Log out and back in, then switch it on in the Extensions app
   (or run `gnome-extensions enable smart-calendar-hub@bria-bria.github.io`).

### From source

```bash
./build-and-install.sh
```

The script builds `dist/smart-calendar-hub@bria-bria.github.io.shell-extension.zip`,
installs it and enables it. On Wayland, log out and back in to load it.

## Translations

Smart Calendar Hub is written in **English** and includes **Italian**.
Any other language can be translated by you, without programming:

1. Log in once with the extension on. The extension creates the file
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
in the `IT` table of the same file. `tools/check-translations.py` checks
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
    // optional: a page of your own instead of the menu, built on every
    // visit and destroyed after it (free timers and signals on 'destroy')
    buildPage: () => new St.Label({text: 'Hello'}),
    // optional: true = the hub leaves your backgrounds alone
    keepStyle: false,
    // optional: the items of your menu that open your preferences, for an
    // extension whose settings the hub shows in the card beside the panel
    settingsItems: [preferencesItem],
};
```

- `settingsItems` lets the hub connect those items to its card however they
  are worded, instead of recognising them by their text. Keep the list
  current if you build your menu anew.
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

### Add a widget to the panel

The panel is a column of widgets: the hub's own (tray, IP addresses,
weather, date, calendar, "Today", notifications, world clocks) and those of
other extensions. Users switch them on and off and move them in
**Settings → Panel sections**; the buttons at the bottom always stay last.

```js
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const HUB = 'smart-calendar-hub@bria-bria.github.io';

enable() {
    // the hub may start after you, or be switched off and on again:
    // add the widget every time it becomes active
    this._hubId = Main.extensionManager.connect('extension-state-changed', (_m, ext) => {
        if (ext.uuid === HUB && ext.state === ExtensionState.ACTIVE)
            this._addToHub();
    });
    this._addToHub();
}

_addToHub() {
    Main.extensionManager.lookup(HUB)?.stateObj?.addWidget?.({
        id: 'my-extension',          // unique, stable: the user's choices are kept by it
        title: 'My extension',       // its name in Panel sections
        size: 'card',                // 'compact', 'card' or 'fill'
        build: () => new St.Label({text: 'Hello'}),
    });
}

disable() {
    Main.extensionManager.disconnect(this._hubId);
    Main.extensionManager.lookup(HUB)?.stateObj?.removeWidget?.('my-extension');
}
```

- **Your widget starts switched off**: it shows up in Panel sections, and the
  user decides whether and where it goes in the panel.
- `build()` is called when the widget is shown (when the user switches it on,
  when the panel is built again after the lock screen) and must return a new
  actor without a parent. The hub destroys it when it is switched off, when
  you call `removeWidget`, on the lock screen and when the hub is switched
  off: free your timers and signals on its `destroy`.
- The hub puts it inside a card with the margins and corners of the panel.
  `'compact'`: a row without a card; `'card'`: a card as tall as its contents;
  `'fill'`: a card that takes the free room. Only one widget fills: the
  notifications when they are shown, otherwise the first `'fill'` widget.
- If `build()` throws or returns an invalid actor, the widget is left out
  (and the error is written in the log). While your extension is off or
  uninstalled, a widget the user switched on leaves an empty card with its
  name.
- `addWidget` returns `false` when the description is not valid or the hub is
  off; calling it again with the same `id` replaces the widget. The panel
  only exists in the user session: added widgets are kept and shown again
  after the lock screen, nothing to do on your side.
- `externalPageFeatures` includes `'widgets'` from this version on.

### Page model

Pages shown in the hub follow one model, so every extension looks like part
of the panel:

1. **The header is the hub's**: back arrow and title. Never draw your own.
2. **Section titles**, small and grey, above groups of rows.
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

The **page kit** gives you these pieces ready-made, with the look of the
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
`button`, `buttons`, `empty`, `notice` (a message that stays in the page),
`setSensitive(piece, on)` (`kit.version` = 2).

**Update in place** instead of building the page again (keeps keyboard focus
and scrolling):

- `row.titleLabel.text`, `row.subtitleLabel.text` (hidden when empty),
  `row.setTrailing(piece | null)`, `row.setSensitive(bool)`;
- `toggle.state = bool` follows the real state without calling `onToggle`;
  a `value` is a label: `value.text = '…'`; `button.setSensitive(bool)`.

**From the hub** (all return `false` when your page is not on screen):

- `hubState.showPageMessage(id, text, seconds = 4)`: a short message at the
  bottom of your page (the result of an action, an error), gone by itself;
- `hubState.setSideCount(id, count)`: the number in the side card's header;
- `hubState.updateExternalPage(id, {buildPage, buildSidePage})`: new contents
  for the page and/or the side page, keeping where they were scrolled.

`externalPageFeatures` lists what the installed hub offers: `'side'`,
`'side-header'`, `'kit'`, `'message'`, `'side-count'`, `'update'`,
`'widgets'`.

## Bring your extension to the hub

Smart Calendar Hub wants to be the place where GNOME extensions meet.

- **You already have an extension:** tell us about it with the
  [integration proposal form](https://github.com/bria-bria/smart-calendar-hub/issues/new?template=integration.yml).
  We try it inside the panel and, if we like it, we work on our side so it
  fits in as well as possible, without touching your code; then it joins the
  recommended extensions.
- **You want to build one for the hub:** the page model and the page kit
  above are public. If you need something that is missing, ask: we add it
  for everyone.
- **You only have an idea:** share it in
  [Discussions → Ideas](https://github.com/bria-bria/smart-calendar-hub/discussions/categories/ideas).
  The most wanted ideas become part of the hub or a new extension.

## How this was made

Smart Calendar Hub is a hands-on collaboration between a person and an AI —
pair programming, with the human in charge.

Michele, its creator, maintainer, and a daily GNOME user, designed the
product: what it does, how it looks, and how it behaves. He made every
decision and tested every change on his own GNOME desktop before it went in.
Claude (Anthropic) worked as his coding partner, writing the implementation
under his direction, and is openly credited in the commit history.

No change is merged without being tested by hand and checked with code
review. Michele takes full ownership and accountability for this code — its
stability, maintenance, bug fixes, and future development.

AI provided the working hands; the direction is human: what this hub does,
and why, comes from someone who uses GNOME every day.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
