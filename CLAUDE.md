# Smart Calendar Hub — istruzioni per Claude

Rispondere sempre in italiano. Guidare Michele un passo alla volta.

## Cos'è
Estensione GNOME Shell (GJS) che trasforma il menu dell'orologio in un
pannello laterale: vassoio icone → titolo → meteo → data → calendario
collassabile → notifiche → orologi mondiali. Mette la temperatura accanto
all'ora e sposta l'ora nella barra in alto.

UUID: `smart-calendar-hub@bria-bria.github.io`. Impostazioni in GSettings
(`org.gnome.shell.extensions.smart-calendar-hub`), non più in un file JSON.

## Origine
Riscritta il 04/11/2026 da `raven-calendar@michele.local` ("Raven Calendar
Sidebar"), che è stata disinstallata. Copia dell'originale (con il vecchio
`~/.config/raven-calendar.json`) in `originale-raven-calendar/`, esclusa da git.

Installazione: `./installa-smart-calendar-hub.sh` (crea lo zip in `dist/`,
toglie la vecchia, installa la nuova). Su Wayland serve logout/login.

Sul PC di Michele è attiva l'opzione `sync-top-bar-organizer` (usa Top Bar
Organizer; la vecchia estensione lo sincronizzava sempre).

Le icone del vassoio le crea l'estensione AppIndicator
(`appindicatorsupport@rgcjonas.gmail.com`): Smart Calendar Hub le sposta
soltanto. Deciso da Michele il 04/11/2026: AppIndicator resta accesa, non va
integrata né spenta; le Preferenze mostrano un avviso se è spenta.

Le icone del vassoio stanno su **una sola riga** (scelta di Michele, 05/11/2026)
con una freccia per lato (◀ ▶) se non ci stanno, niente barra di scorrimento; ogni icona è in una casella
nostra (`sch-tray-cell`, 32 px) con l'icona centrata, perché i pulsanti delle
altre estensioni hanno larghezze diverse (con `set_size` sul contenitore non
funzionava). NON usare `Clutter.FlowLayout`: su GNOME 51 dà altezza 0 ai
pulsanti del pannello.

Mai distruggere il **genitore** di un attore dentro il segnale `destroy` di
quell'attore (05/11/2026: la casella del vassoio distrutta nel `destroy`
dell'icona faceva crollare GNOME Shell con "clutter_actor_destroy_all_children:
assertion failed", e dopo il crash GNOME spegne tutte le estensioni). Rimandare
a un idle.

Niente **margini negativi** nel CSS (es. `margin-top: -4px`): il 05/11/2026
uno solo nei puntini delle città rendeva il pannello invisibile (si apriva ma
GNOME non lo disegnava: "cogl_framebuffer_set_viewport: width > 0 && height > 0").

I commit usano l'email anonima 301696067+bria-bria@users.noreply.github.com
(configurata in questo repository). Il 04/11/2026 l'email personale è stata
tolta anche dai primi 3 commit (storia riscritta prima di renderlo pubblico).

## Schermate di blocco e di accesso (dal 05/11/2026)
`session-modes`: user, unlock-dialog, gdm. Due livelli in `extension.js`:
`TopBarStyle` (`sch-topbar-style.js`: colore d'accento, spazio icone, sulla
schermata di accesso anche la posizione dell'ora) è sempre attivo; tutto il
resto (`_enableFull`/`_disableFull`) solo nella sessione, spento al blocco
schermo. Schermata di accesso: `sudo ./installa-schermata-accesso.sh` (copia
l'estensione in /usr/share e le impostazioni di Michele nel dconf di gdm,
`/etc/dconf/db/gdm.d/90-smart-calendar-hub`); `--rimuovi` per togliere.
Da rilanciare dopo aver cambiato colore/spazio/posizione o aggiornato.

## Traduzioni (dal 04/11/2026, come BlueHub)
Testi del codice in **inglese**, passati a `_()` di `extension/sch-i18n.js`, con i
valori come segnaposto `{nome}` (mai pezzi di frase concatenati). L'italiano è
nella tabella `IT` dello stesso file, che è anche l'elenco completo delle frasi:
**ogni frase nuova va aggiunta a `IT`**. Controllo: `strumenti/controlla-traduzioni.py`
(lo lancia anche `installa-smart-calendar-hub.sh`). Le altre lingue le traducono
gli utenti in `~/.config/smart-calendar-hub/translations/<lingua>.json`: le
Preferenze aggiungono in fondo le frasi nuove senza toccare quelle tradotte.
Il vecchio gettext (`po/`) è stato tolto.

**Alla fine di ogni modifica importante fare la revisione con la skill
code-review.**

## Immagini (screenshots/)
`screenshots/mockup.html` ricostruisce il pannello in inglese (dati inventati,
account example.com). Rigenerare i PNG con Firefox invisibile:
`firefox --headless --no-remote --profile <cartella vuota> --window-size=1280,800
--screenshot screenshots/2-calendar.png "file://…/screenshots/mockup.html#calendar"`
(scene: overview, calendar, night, prefs). Se cambia l'aspetto del pannello,
aggiornare anche il mockup.

## Pubblicazione
- GitHub: `bria-bria/smart-calendar-hub`, reso **pubblico** il 04/11/2026 (serve a extensions.gnome.org);
  campo `url` aggiunto il 04/11/2026 (extensions.gnome.org lo rifiutava senza): funziona solo con il repository pubblico.
- extensions.gnome.org: carica Michele lo zip di `dist/`. Solo con il suo sì.
  Immagine principale scelta da Michele (04/11/2026): `screenshots/1-overview.png`.
- Versioni GNOME dichiarate: 48–51 (`St.BoxLayout.orientation` e
  `-st-accent-color` richiedono GNOME 48). Provata solo su 51.
