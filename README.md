# Smart Calendar Hub

A GNOME Shell extension that turns the clock menu into a side panel.

From top to bottom the panel shows:

1. tray icons of applications (optional),
2. a small header with quick layout options,
3. weather,
4. today's date,
5. the calendar and events, collapsed by default,
6. notifications,
7. world clocks.

It also shows the current temperature next to the clock (unless another
extension, such as Weather O'Clock, already does it) and lets you move the
clock to a different spot of the top bar.

## Requirements

GNOME Shell 48, 49, 50 or 51. The weather comes from GNOME Weather: set a
location there to see the temperature.

Tray icons of applications are created by the
[AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/)
extension: keep it enabled. Smart Calendar Hub only moves those icons inside
the panel; the preferences window shows a warning when that extension is off.

## Settings

Open the extension preferences (Extensions app → Smart Calendar Hub) or click
the gear icon in the panel header.

- **Panel side**: right edge, left edge, or under the clock button.
- **Clock in the top bar**: right before the system menu, right before the
  tray icons, left after the menus, or center.
- **Icons inside the panel**: tray icons of applications, all right-side
  icons, or none.
- **Keep Top Bar Organizer in sync** (off by default): if you use the Top Bar
  Organizer extension, the clock position is also written into its settings;
  the previous order is restored when Smart Calendar Hub is turned off.
  If you use Top Bar Organizer, turn this on: otherwise both extensions try
  to place the clock.
- **Calendar collapsed on opening** and **panel width**.

## Install from source

```bash
./installa-smart-calendar-hub.sh
```

The script builds `dist/smart-calendar-hub@bria-bria.github.io.shell-extension.zip`,
installs it and enables it. On Wayland, log out and back in to load it.

## Translations

Source strings are in English; `extension/po/it.po` contains the Italian
translation.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
