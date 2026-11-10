// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Our own settings in the card beside the panel, their only home (the
// settings button of the panel opens them): the list of the sections, then
// the settings of one, built with our page kit from sch-settings-model.js.
// Every change is written at once and the panel follows it.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';
import {check as checkIcon, roundButton} from './sch-ext-settings.js';
import {pageKit as kit} from './sch-page-kit.js';
import {
    APPINDICATOR_UUIDS, BII_UUID, appItems, biiRowTexts, calendarRows, mutedEntries,
    setAppOn, setCalendarShown, settingsSections, unmuteApp,
} from './sch-settings-model.js';
import {FIXED_WIDGETS, HUB_WIDGETS, moveWidget, setWidgetOn, widgetOrder} from './sch-widgets.js';
import {
    BUTTON_ACTIONS, DEFAULT_PROFILE, PROFILE_COLORS, actionKind, actionLabel, activeProfileId, colorLabel,
    colorValue, createProfile, deleteProfile, newProfileName, profileList, readProfile, setActiveProfile,
    updateProfile,
} from './sch-profiles.js';

// 'active', 'off' (installed, can be switched on) or 'missing' (not
// installed, or broken: to be taken again from extensions.gnome.org)
const BROKEN = [ExtensionState.ERROR, ExtensionState.OUT_OF_DATE, ExtensionState.UNINSTALLED];
function biiState() {
    const ext = Main.extensionManager.lookup(BII_UUID);
    if (!ext || BROKEN.includes(ext.state))
        return 'missing';
    return ext.state === ExtensionState.ACTIVE ? 'active' : 'off';
}

// Whether the extension that makes the tray icons is on
function appIndicatorOn() {
    return APPINDICATOR_UUIDS.some(uuid =>
        Main.extensionManager.lookup(uuid)?.state === ExtensionState.ACTIVE);
}

const arrowIcon = open => new St.Icon({icon_name: open ? 'pan-down-symbolic' : 'pan-end-symbolic', icon_size: 16});

// The list of the sections, a row each; onOpen(id) on a click
// extra: more entries after the sections ({id, title, icon}), pages of
// their own that open in the same card (e.g. "System updates"); footer: a
// piece under them (the version of the hub)
export function buildSectionList(onOpen, extra = [], footer = null) {
    return kit.page(kit.card([...settingsSections(), ...extra].map(section => kit.row({
        icon: section.icon,
        title: section.title,
        trailing: kit.chevron(),
        onActivate: () => onOpen(section.id),
    }))), footer);
}

// The rows of one row of the description (a switch with the rows inside it,
// a choice with its values); parentOn: the rows are inside a switch that
// must be on. ctx: {settings, env, syncs, closePanel}
function modelRows(row, ctx, parentOn = null) {
    const {settings, env, syncs} = ctx;
    const enabled = () => (parentOn?.() ?? true) && (row.enabledWhen?.(settings) ?? true);
    const visible = () => row.visibleWhen?.(settings, env) ?? true;
    const actors = [];
    const children = []; // the rows of row.children, with syncs of their own
    let parts = []; // buttons inside a row: switched off with it

    switch (row.type) {
    case 'switch':
    case 'check': {
        const sw = kit.toggle({
            active: settings.get_boolean(row.key),
            onToggle: state => settings.set_boolean(row.key, state),
        });
        actors.push(kit.row({title: row.title, subtitle: row.subtitle ?? '', trailing: sw, wrap: true}));
        syncs.push(() => {
            if (sw.state !== settings.get_boolean(row.key))
                sw.state = settings.get_boolean(row.key);
        });
        // the rows inside follow their own state (this switch included)
        const on = () => enabled() && settings.get_boolean(row.key);
        for (const child of row.children ?? []) {
            for (const actor of modelRows(child, ctx, on)) {
                actor.add_style_class_name('sch-set-child');
                children.push(actor);
            }
        }
        break;
    }
    case 'choice': {
        // the chosen value under the title; a click shows every value, with
        // a check on the chosen one
        let open = false;
        const labelOf = value => row.options.find(([v]) => v === value)?.[1] ?? '';
        const options = [];
        const header = kit.row({
            title: row.title,
            subtitle: labelOf(settings.get_string(row.key)),
            trailing: arrowIcon(false),
            wrap: true,
            onActivate: () => {
                open = !open;
                header.setTrailing(arrowIcon(open));
                options.forEach(option => {
                    option.visible = open && visible();
                });
            },
        });
        actors.push(header);
        for (const [value, label] of row.options) {
            const option = kit.row({
                title: label,
                wrap: true,
                onActivate: () => {
                    if (settings.get_string(row.key) !== value)
                        settings.set_string(row.key, value);
                },
            });
            option.add_style_class_name('sch-set-child');
            // shown only while the choice is open (see the sync below)
            option.schOption = true;
            option.visible = false;
            options.push(option);
            actors.push(option);
            let checked = false;
            syncs.push(() => {
                if (checked !== (settings.get_string(row.key) === value)) {
                    checked = !checked;
                    option.setTrailing(checked ? checkIcon() : null);
                }
            });
        }
        syncs.push(() => {
            header.subtitleLabel.text = labelOf(settings.get_string(row.key));
            options.forEach(option => {
                option.visible = open && visible();
            });
        });
        break;
    }
    case 'number': {
        // − and + around the value, like Freon's «Read the sensors every»
        const shown = kit.value('');
        const step = sign => settings.set_int(row.key,
            Math.max(row.min, Math.min(row.max, settings.get_int(row.key) + sign * row.step)));
        const less = roundButton('list-remove-symbolic', _('Less'), () => step(-1));
        const more = roundButton('list-add-symbolic', _('More'), () => step(1));
        const box = new St.BoxLayout({style_class: 'sch-ext-stepper', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(less);
        box.add_child(shown);
        box.add_child(more);
        actors.push(kit.row({title: row.title, subtitle: row.subtitle ?? '', trailing: box, wrap: true}));
        parts = [less, more];
        syncs.push(() => {
            const n = settings.get_int(row.key);
            shown.text = String(n);
            // the end of the range: that button does nothing
            less.opacity = n > row.min ? 255 : 100;
            more.opacity = n < row.max ? 255 : 100;
        });
        break;
    }
    case 'info':
        actors.push(kit.row({icon: row.icon ?? null, title: row.title, subtitle: row.subtitle ?? '', wrap: true}));
        break;
    case 'command': {
        // the button turns into a check once the command is copied
        const copy = roundButton('edit-copy-symbolic', _('Copy the command'), () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, row.command);
            copy.child.icon_name = 'object-select-symbolic';
        });
        actors.push(kit.row({title: row.title, subtitle: row.command, trailing: copy, wrap: true}));
        parts = [copy];
        break;
    }
    case 'link': {
        const open = pillButton(row.button, () => openPage(ctx.closePanel, row.url));
        actors.push(kit.row({title: row.title, subtitle: row.subtitle ?? '', trailing: open, wrap: true}));
        parts = [open];
        break;
    }
    case 'custom':
        if (row.id === 'bii') {
            const bii = biiRow(ctx);
            actors.push(bii.row);
            parts = [bii.button];
        }
        break;
    }

    if (actors.length) {
        syncs.push(() => {
            const on = enabled();
            const show = visible();
            for (const actor of actors) {
                actor.setSensitive(on);
                if (!actor.schOption)
                    actor.visible = show;
            }
            for (const part of parts)
                kit.setSensitive(part, on);
        });
    }
    return [...actors, ...children];
}

// A pill button for the right of a row
function pillButton(label, onClick) {
    const button = kit.button({label, onClick});
    button.x_expand = false;
    button.y_align = Clutter.ActorAlign.CENTER;
    return button;
}

// A page in the browser, which opens above the panel: the panel goes
// (closePanel)
export function openPage(closePanel, url) {
    closePanel();
    try {
        Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (e) {
        logError(`cannot open ${url}: ${e}`);
    }
}

// Battery Indicator Icon by Deminder: its project page while it is active,
// "Turn on" if installed but off, "Get it" (its page on extensions.gnome.org)
// if missing
function biiRow(ctx) {
    let action = null;
    const button = pillButton('', () => {
        if (action === 'enable') {
            // false when GNOME refuses (e.g. all extensions are off)
            if (!Main.extensionManager.enableExtension(BII_UUID))
                row.subtitleLabel.text = _('GNOME did not turn it on: check that extensions are on in the Extensions app');
        } else if (action) {
            openPage(ctx.closePanel, action);
        }
    });
    const row = kit.row({
        icon: 'battery-good-symbolic',
        title: 'Battery Indicator Icon',
        trailing: button,
        wrap: true,
    });
    ctx.syncs.push(() => {
        const texts = biiRowTexts(ctx.env.bii);
        action = texts.action;
        row.subtitleLabel.text = texts.subtitle;
        button.label = texts.button;
        if (texts.primary)
            button.add_style_class_name('sch-kit-button-primary');
        else
            button.remove_style_class_name('sch-kit-button-primary');
    });
    return {row, button};
}

// One switch per app of an 'apps' group. The rows are built again only
// when the apps change; a switch only follows its value.
function appsCard(group, ctx) {
    const {settings, syncs} = ctx;
    const apps = group.apps;
    const card = kit.card();
    let shape = null;
    let switches = new Map();
    let rows = [];
    syncs.push(() => {
        const items = appItems(settings, apps);
        const now = JSON.stringify(items.map(item => [item.key, item.label]));
        if (now !== shape) {
            shape = now;
            card.destroy_all_children();
            switches = new Map();
            rows = [];
            if (!items.length)
                card.add_child(kit.row({title: apps.emptyTitle, subtitle: apps.emptySubtitle, wrap: true}));
            for (const item of items) {
                const sw = kit.toggle({onToggle: on => setAppOn(settings, apps, item.key, on)});
                const row = kit.row({
                    title: item.label,
                    subtitle: item.key !== item.label ? item.key : '',
                    trailing: sw,
                    wrap: true,
                });
                card.add_child(row);
                switches.set(item.key, sw);
                rows.push(row);
            }
        }
        for (const item of items) {
            const sw = switches.get(item.key);
            if (sw.state !== item.on)
                sw.state = item.on;
        }
        const on = apps.enabledWhen?.(settings) ?? true;
        rows.forEach(row => row.setSensitive(on));
    });
    return card;
}

// The apps silenced with the bell of a notification, each with a button
// that turns it back on
function mutedCard(group, ctx) {
    const card = kit.card();
    let shape = null;
    ctx.syncs.push(() => {
        const entries = mutedEntries(ctx.settings);
        const now = JSON.stringify(entries);
        if (now === shape)
            return;
        shape = now;
        card.destroy_all_children();
        if (!entries.length)
            card.add_child(kit.row({title: group.emptyTitle}));
        for (const entry of entries) {
            card.add_child(kit.row({
                title: entry.label,
                subtitle: entry.when,
                trailing: pillButton(group.unmute, () => unmuteApp(ctx.settings, entry.key)),
                wrap: true,
            }));
        }
    });
    return card;
}

// One switch per calendar, with its colour and account, read without
// blocking GNOME Shell (the card fills in when the answer comes)
function calendarsCard(group, ctx) {
    const card = kit.card();
    const cancellable = new Gio.Cancellable();
    card.connect('destroy', () => cancellable.cancel());
    const fill = calendars => {
        if (!calendars.length)
            card.add_child(kit.row({title: group.emptyTitle, subtitle: group.emptySubtitle, wrap: true}));
        for (const cal of calendars)
            card.add_child(calendarRow(cal, ctx, cancellable));
    };
    // the card may be gone by the time the answer comes
    calendarRows(cancellable)
        .then(calendars => !cancellable.is_cancelled() && fill(calendars))
        .catch(e => {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            logError(`cannot read the calendars: ${e}`);
            fill([]);
        });
    return card;
}

function calendarRow(cal, ctx, cancellable) {
    // Writes run one after another (quick toggles keep their order); if a
    // write fails the switch goes back, so it never lies.
    let queue = Promise.resolve();
    const sw = kit.toggle({
        active: cal.selected,
        onToggle: wanted => {
            queue = queue
                // not cancelled with the card: a switch flipped stays flipped
                .then(() => setCalendarShown(cal, wanted))
                .then(() => ctx.reloadCalendars())
                .catch(e => {
                    logError(`cannot change calendar ${cal.name}: ${e}`);
                    if (!cancellable.is_cancelled())
                        sw.state = !wanted;
                });
        },
    });
    const row = kit.row({title: cal.name, subtitle: cal.account, trailing: sw, wrap: true});
    // the dot in the colour of the calendar, as in the panel
    row.get_child().insert_child_at_index(new St.Widget({
        style: `background-color: ${cal.color}; border-radius: 6px;`,
        width: 12,
        height: 12,
        y_align: Clutter.ActorAlign.CENTER,
    }), 0);
    // shared only for reading: nothing to switch
    row.setSensitive(cal.paths.length > 0);
    return row;
}

// The warning while the extension that makes the tray icons is off
function appIndicatorNotice(group, ctx) {
    const notice = kit.notice({icon: 'dialog-warning-symbolic', text: group.text});
    ctx.syncs.push(() => {
        notice.visible = !ctx.env.appIndicator && ctx.settings.get_string('tray-mode') !== 'disabled';
    });
    return notice;
}

// The widgets of the panel in their order: a switch each and two arrows.
// Rebuilt when the list changes (an arrow moves a row: the keyboard focus
// goes back to its arrow)
function widgetsCard(ctx, profileId) {
    const {settings, syncs, widgetRegistry: registry} = ctx;
    const card = kit.card();
    let shape = null;
    syncs.push(() => {
        const order = widgetOrder(settings, registry.ids, profileId);
        const now = JSON.stringify(order);
        if (now === shape)
            return;
        shape = now;
        const focused = global.stage.get_key_focus()?.schWidgetArrow ?? null;
        card.destroy_all_children();
        order.forEach(({id, on}, i) => {
            const arrow = (icon, label, delta, enabled) => {
                const button = roundButton(icon, label, () => moveWidget(settings, registry.ids, id, delta, profileId));
                button.schWidgetArrow = `${id}:${delta}`;
                kit.setSensitive(button, enabled);
                return button;
            };
            const up = arrow('go-up-symbolic', _('Move up'), -1, i > 0);
            const down = arrow('go-down-symbolic', _('Move down'), 1, i < order.length - 1);
            const fixed = FIXED_WIDGETS.includes(id);
            const sw = kit.toggle({active: on, onToggle: state => setWidgetOn(settings, registry.ids, id, state, profileId)});
            kit.setSensitive(sw, !fixed);
            const trailing = new St.BoxLayout({style_class: 'sch-ext-stepper', y_align: Clutter.ActorAlign.CENTER});
            [up, down, sw].forEach(piece => trailing.add_child(piece));
            let subtitle = '';
            if (fixed)
                subtitle = _('Always shown: it holds the settings button');
            else if (!HUB_WIDGETS.includes(id) && !registry.get(id))
                subtitle = _('Not available: its extension is off or not installed');
            card.add_child(kit.row({title: registry.title(id), subtitle, trailing, wrap: true}));
            for (const button of [up, down]) {
                if (button.schWidgetArrow === focused)
                    button.grab_key_focus();
            }
        });
    });
    return card;
}

// The profiles: a click uses one, its arrow opens its page; then "New
// profile", a copy of the one in use
function profilesCard(group, ctx) {
    const {settings, syncs} = ctx;
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    const card = kit.card();
    box.add_child(card);
    box.add_child(kit.buttons(kit.button({
        label: _('New profile'),
        primary: true,
        onClick: () => {
            const previous = activeProfileId(settings);
            ctx.openSection(`profile:${createProfile(settings, newProfileName(settings))}`, {focusName: true, previous});
        },
    })));
    let shape = null;
    syncs.push(() => {
        const active = activeProfileId(settings);
        const list = profileList(settings);
        const now = JSON.stringify([active, list]);
        if (now === shape)
            return;
        shape = now;
        card.destroy_all_children();
        for (const {id, name, color} of list) {
            const row = kit.row({
                title: name,
                subtitle: id === active ? _('In use') : '',
                trailing: roundButton('go-next-symbolic', _('Change this profile'), () => ctx.openSection(`profile:${id}`)),
                onActivate: () => setActiveProfile(settings, id),
            });
            row.get_child().insert_child_at_index(colorDot(color), 0);
            card.add_child(row);
        }
    });
    return box;
}

// The dot in the colour of a profile (an empty ring without colour)
function colorDot(color) {
    const value = colorValue(color);
    return new St.Widget({
        style: value
            ? `background-color: ${value}; border-radius: 6px;`
            : 'border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 6px;',
        width: 12,
        height: 12,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

// The label of a button of the bottom row: the app's name for an app
function buttonLabel(action) {
    if (actionKind(action) !== 'app')
        return actionLabel(action);
    const app = Shell.AppSystem.get_default().lookup_app(action.slice('app:'.length));
    return app ? app.get_name() : _('An app that is no longer installed');
}

// The page of one profile: name, use it, colour, sections of the panel,
// buttons at the bottom; at the end Delete, or Save and Cancel for a profile
// just created (focusName; Cancel goes back to the profile in use before,
// previous)
function profilePage(settings, profileId, ctx, {focusName = false, previous = null} = {}) {
    const {syncs} = ctx;
    const pieces = [];
    const exists = () => profileList(settings).some(p => p.id === profileId);
    const isDefault = profileId === DEFAULT_PROFILE;
    const isNew = focusName;

    pieces.push(kit.section(_('Name')));
    const entry = new St.Entry({
        style_class: 'sch-ext-entry',
        text: readProfile(settings, profileId).name,
        can_focus: true,
        x_expand: true,
    });
    entry.clutter_text.single_line_mode = true;
    const commit = () => {
        const name = entry.text.trim();
        if (name && exists() && name !== readProfile(settings, profileId).name)
            updateProfile(settings, profileId, {name});
    };
    entry.clutter_text.connect('activate', commit);
    entry.clutter_text.connect('key-focus-out', commit);
    pieces.push(entry);
    if (focusName) {
        entry.connect('notify::mapped', () => {
            if (entry.mapped && focusName) {
                focusName = false;
                entry.grab_key_focus();
                entry.clutter_text.set_selection(0, -1);
            }
        });
    }

    const use = kit.row({title: _('Use this profile'), onActivate: () => setActiveProfile(settings, profileId)});
    pieces.push(kit.card(use));
    syncs.push(() => {
        const inUse = activeProfileId(settings) === profileId;
        use.setTrailing(inUse ? checkIcon() : null);
        use.subtitleLabel.text = inUse ? _('In use') : '';
    });

    pieces.push(kit.section(_('Colour of the settings button')));
    const colors = kit.card();
    for (const color of ['', ...PROFILE_COLORS.map(([name]) => name)]) {
        const row = kit.row({
            title: colorLabel(color),
            onActivate: () => updateProfile(settings, profileId, {color}),
        });
        row.get_child().insert_child_at_index(colorDot(color), 0);
        colors.add_child(row);
        let checked = null;
        syncs.push(() => {
            const now = exists() && readProfile(settings, profileId).color === color;
            if (now !== checked) {
                checked = now;
                row.setTrailing(now ? checkIcon() : null);
            }
        });
    }
    pieces.push(colors);

    pieces.push(kit.section(_('Panel sections')));
    pieces.push(descriptionLabel(_('Switch the sections on or off and move them with the arrows. Those of other extensions start switched off.')));
    pieces.push(widgetsCard(ctx, profileId));

    pieces.push(kit.section(_('Buttons at the bottom')));
    pieces.push(descriptionLabel(_('Three places; with the calendar open only "New event" is shown.')));
    const buttons = kit.card();
    for (let slot = 0; slot < 3; slot++)
        buttonRows(settings, profileId, slot, ctx).forEach(row => buttons.add_child(row));
    pieces.push(buttons);

    if (isNew) {
        pieces.push(kit.buttons(
            kit.button({
                label: _('Save profile'),
                primary: true,
                onClick: () => {
                    commit();
                    ctx.openSection('profiles');
                },
            }),
            kit.button({
                label: _('Cancel'),
                onClick: () => {
                    deleteProfile(settings, profileId);
                    if (previous && profileList(settings).some(p => p.id === previous))
                        setActiveProfile(settings, previous);
                    ctx.openSection('profiles');
                },
            })));
    } else if (!isDefault) {
        let armed = false;
        const remove = kit.button({
            label: _('Delete profile'),
            onClick: () => {
                if (!armed) {
                    armed = true;
                    remove.label = _('Click again to delete it');
                    return;
                }
                deleteProfile(settings, profileId);
                ctx.openSection('profiles');
            },
        });
        remove.add_style_class_name('sch-kit-button-destructive');
        pieces.push(kit.buttons(remove));
    }
    return pieces;
}

// One button of the bottom row: its action under the title; a click shows
// the actions, with a check on the chosen one ("Open an app" opens the list
// of the apps)
const ONCE_ONLY = ['clocks', 'new-event', 'clear'];

function buttonRows(settings, profileId, slot, ctx) {
    const action = () => readProfile(settings, profileId).buttons[slot];
    let open = false;
    const options = [];
    const header = kit.row({
        title: _('Button {n}', {n: slot + 1}),
        subtitle: buttonLabel(action()),
        trailing: arrowIcon(false),
        wrap: true,
        onActivate: () => {
            open = !open;
            header.setTrailing(arrowIcon(open));
            options.forEach(option => {
                option.visible = open;
            });
        },
    });
    // World clocks, New event and Clear exist once: taken from another place
    const choose = value => {
        const buttons = readProfile(settings, profileId).buttons
            .map((b, i) => (i !== slot && ONCE_ONLY.includes(value) && actionKind(b) === value ? 'none' : b));
        buttons[slot] = value;
        updateProfile(settings, profileId, {buttons});
    };
    for (const kind of BUTTON_ACTIONS) {
        const option = kit.row({
            title: actionLabel(kind),
            wrap: true,
            onActivate: () => (kind === 'app'
                ? ctx.openSection(`profile:${profileId}:app:${slot}`)
                : choose(kind)),
        });
        option.add_style_class_name('sch-set-child');
        option.visible = false;
        options.push(option);
        ctx.syncs.push(() => option.setTrailing(actionKind(action()) === kind ? checkIcon() : null));
    }
    ctx.syncs.push(() => {
        header.subtitleLabel.text = buttonLabel(action());
    });
    return [header, ...options];
}

// The installed apps, for a button of the bottom row
function appPage(settings, profileId, slot, ctx) {
    const apps = Shell.AppSystem.get_default().get_installed()
        .filter(info => info.should_show())
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
    const card = kit.card(...apps.map(info => kit.row({
        icon: info.get_icon(),
        title: info.get_display_name(),
        onActivate: () => {
            const buttons = readProfile(settings, profileId).buttons;
            buttons[slot] = `app:${info.get_id()}`;
            updateProfile(settings, profileId, {buttons});
            ctx.openSection(`profile:${profileId}`);
        },
    })));
    return [card];
}

function descriptionLabel(text) {
    const label = new St.Label({style_class: 'sch-set-description', x_expand: true, text});
    label.clutter_text.line_wrap = true;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

// The pages under a section: 'profile:<id>' (parent 'profiles') and
// 'profile:<id>:app:<slot>' (parent 'profile:<id>')
function parseSubpage(id) {
    const match = /^profile:([^:]+)(?::app:(\d))?$/.exec(id ?? '');
    return match ? {profileId: match[1], slot: match[2] === undefined ? null : Number(match[2])} : null;
}

// The page the back arrow of `id` goes to (null: the list of the sections)
export function hubSectionParent(id) {
    const sub = parseSubpage(id);
    if (!sub)
        return null;
    return sub.slot === null ? 'profiles' : `profile:${sub.profileId}`;
}

// The title of a page of our settings
export function hubSectionTitle(settings, id) {
    const sub = parseSubpage(id);
    if (sub?.slot !== null && sub)
        return _('Choose an app');
    if (sub)
        return profileList(settings).find(p => p.id === sub.profileId)?.name ?? '';
    return settingsSections().find(section => section.id === id)?.title ?? '';
}

const GROUP_CARDS = {apps: appsCard, muted: mutedCard, calendars: calendarsCard, profiles: profilesCard};

// The settings of section `id`, or null when there is no such section.
// closePanel: closes the panel (before a browser opens); reloadCalendars:
// the calendar of the panel reads its calendars again; widgetRegistry: the
// widgets of other extensions; openSection(id, options): shows another
// page of our settings; options: for a new profile {focusName: true}
export function buildSectionPage(settings, id, {closePanel, reloadCalendars, widgetRegistry, openSection, options}) {
    const section = settingsSections().find(s => s.id === id);
    const sub = parseSubpage(id);
    if (!section && !sub)
        return null;
    const env = {bii: biiState(), appIndicator: appIndicatorOn()};
    const syncs = [];
    const ctx = {settings, env, syncs, closePanel, reloadCalendars, widgetRegistry, openSection};
    const pieces = [];
    if (sub) {
        pieces.push(...(sub.slot === null
            ? profilePage(settings, sub.profileId, ctx, options)
            : appPage(settings, sub.profileId, sub.slot, ctx)));
    }
    for (const group of section?.groups ?? []) {
        if (group.kind === 'appindicator') {
            pieces.push(appIndicatorNotice(group, ctx));
            continue;
        }
        const card = GROUP_CARDS[group.kind]?.(group, ctx) ??
            (group.rows.length ? kit.card(group.rows.flatMap(row => modelRows(row, ctx))) : null);
        if (group.title)
            pieces.push(kit.section(group.title));
        if (group.description) {
            const text = new St.Label({style_class: 'sch-set-description', x_expand: true});
            text.clutter_text.line_wrap = true;
            text.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            const sync = () => {
                const value = typeof group.description === 'function'
                    ? group.description(settings, env) : group.description;
                text.text = value ?? '';
                text.visible = !!value;
            };
            syncs.push(sync);
            pieces.push(text);
        }
        if (card)
            pieces.push(card);
    }
    const page = kit.page(pieces);
    const sync = () => syncs.forEach(fn => fn());
    sync();
    const settingsId = settings.connect('changed', sync);
    const extId = Main.extensionManager.connect('extension-state-changed', (_m, ext) => {
        if (ext?.uuid !== BII_UUID && !APPINDICATOR_UUIDS.includes(ext?.uuid))
            return;
        env.bii = biiState();
        env.appIndicator = appIndicatorOn();
        sync();
    });
    page.connect('destroy', () => {
        settings.disconnect(settingsId);
        Main.extensionManager.disconnect(extId);
    });
    return page;
}
