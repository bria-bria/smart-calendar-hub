# Smart Calendar Hub

A GNOME Shell extension that turns the clock menu into a side panel.

From top to bottom the panel shows:

1. tray icons of applications (optional),
2. weather, collapsed at login (it stays as you leave it until you log out),
   next to the button that opens the settings,
3. today's date,
4. the calendar and events, collapsed by default,
5. notifications,
6. world clocks, next to the button that clears the notifications.

It also shows the current temperature next to the clock (unless another
extension, such as Weather O'Clock, already does it) and lets you move the
clock to a different spot of the top bar.

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
icon next to the weather. They are in five tabs:

- **Panel**: panel side (right, left, under the clock), clock position in the
  top bar, Top Bar Organizer sync (off by default; turn it on if you use Top
  Bar Organizer, otherwise both extensions try to place the clock), the sky
  next to the date (sun and moon of the day, moon phase: each can be switched
  on alone), calendar collapsed on opening, panel width.
- **Tray**: which top bar icons move inside the panel, and a switch for each
  app.
- **Calendars**: which calendars are shown. This is the same switch GNOME
  Calendar uses, so a calendar turned off here is off there too (your online
  accounts are not changed). Calendars shared between two accounts appear once.
- **Notifications**: apps silenced with the bell of a notification (1 hour,
  8 hours, until tomorrow morning, always; "Unmute" to undo) and the apps that
  light the red dot on the clock — for notifications, or when their tray icon
  changes from the usual one (e.g. an unread badge).
- **Network**: IP addresses in the top bar (left, center or right), local
  network address, public address.

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

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
