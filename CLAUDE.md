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

Le icone del vassoio sono in righe (`_layoutTray`): NON usare
`Clutter.FlowLayout`, su GNOME 51 dà altezza 0 ai pulsanti del pannello.

I commit usano l'email anonima 301696067+bria-bria@users.noreply.github.com
(configurata in questo repository). I primi 3 commit hanno ancora l'email
personale.

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

## Pubblicazione
- GitHub: `bria-bria/smart-calendar-hub`, **privato** (come BlueHub);
  niente campo `url` in `metadata.json` finché resta privato.
- extensions.gnome.org: carica Michele lo zip di `dist/`. Solo con il suo sì.
- Versioni GNOME dichiarate: 48–51 (`St.BoxLayout.orientation` e
  `-st-accent-color` richiedono GNOME 48). Provata solo su 51.
