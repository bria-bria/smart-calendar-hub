# Smart Calendar Hub — indice

| File | Cosa contiene |
|---|---|
| `extension/extension.js` | Tutta la logica: pannello laterale, posizione dell'ora, temperatura, icone del vassoio |
| `extension/prefs.js` | Finestra Preferenze |
| `extension/stylesheet.css` | Aspetto (classi `sch-*`) |
| `extension/metadata.json` | Nome, UUID, versioni GNOME supportate |
| `extension/schemas/…gschema.xml` | Impostazioni (GSettings) |
| `extension/po/it.po` | Traduzione italiana (i testi nel codice sono in inglese) |
| `installa-smart-calendar-hub.sh` | Crea lo zip, toglie la vecchia Raven, installa e attiva |
| `README.md` | Descrizione pubblica (inglese) |
| `LICENSE` | GPL-2.0 |
| `originale-raven-calendar/` | Copia della vecchia estensione (non in git) |

## Strada verso extensions.gnome.org
- [x] Riscrittura con nuovo nome e UUID `smart-calendar-hub@bria-bria.github.io` (04/11/2026)
- [x] Impostazioni in GSettings invece di `~/.config/raven-calendar.json`
- [x] Niente `import()` dinamico, timer rimossi in `disable()`, testi traducibili
- [x] Licenza GPL-2.0-or-later + SPDX
- [x] Vecchia `raven-calendar@michele.local` disinstallata, nuova installata (04/11/2026)
- [ ] Prova dopo logout/login
- [x] Revisione code-review: 8 correzioni su 9 (04/11/2026)
- [x] Su GitHub, privato: `bria-bria/smart-calendar-hub` (04/11/2026)
- [x] Scelta delle singole app dentro/fuori dal pannello nelle Preferenze (04/11/2026)
- [ ] Caricamento zip di `dist/` su extensions.gnome.org (lo fa Michele)
