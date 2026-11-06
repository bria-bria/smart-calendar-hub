// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Our own settings in the card beside the panel (the settings button of the
// panel opens them): the list of the sections, then the settings of one,
// built with our page kit from sch-settings-model.js, the same description
// the Preferences window uses. Every change is written at once and the
// panel follows it; changes made elsewhere (the Preferences window) show up
// here too.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';
import {check as checkIcon, roundButton} from './sch-ext-settings.js';
import {pageKit as kit} from './sch-page-kit.js';
import {BII_UUID, biiRowTexts, settingsSections} from './sch-settings-model.js';

// 'active', 'off' (installed, can be switched on) or 'missing' (not
// installed, or broken: to be taken again from extensions.gnome.org)
const BROKEN = [ExtensionState.ERROR, ExtensionState.OUT_OF_DATE, ExtensionState.UNINSTALLED];
function biiState() {
    const ext = Main.extensionManager.lookup(BII_UUID);
    if (!ext || BROKEN.includes(ext.state))
        return 'missing';
    return ext.state === ExtensionState.ACTIVE ? 'active' : 'off';
}

const arrowIcon = open => new St.Icon({icon_name: open ? 'pan-down-symbolic' : 'pan-end-symbolic', icon_size: 16});

// The sections the card shows: those described in sch-settings-model.js
// (the others are only in the Preferences window, for now)
export function hubSections() {
    return settingsSections().filter(section => section.groups);
}

// The list of the sections, a row each; onOpen(id) on a click
export function buildSectionList(onOpen) {
    return kit.page(kit.card(hubSections().map(section => kit.row({
        icon: section.icon,
        title: section.title,
        trailing: kit.chevron(),
        onActivate: () => onOpen(section.id),
    }))));
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
        // as in the Preferences: the chosen value under the title, a click
        // shows every value, with a check on the chosen one
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
        // − and + around the value, as «Read the sensors every» of Freon
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

// Battery Indicator Icon by Deminder: its project page while it is active,
// "Turn on" if installed but off, "Get it" (its page on extensions.gnome.org)
// if missing
function biiRow(ctx) {
    let action = null;
    const button = kit.button({
        onClick: () => {
            if (action === 'enable') {
                // false when GNOME refuses (e.g. all extensions are off)
                if (!Main.extensionManager.enableExtension(BII_UUID))
                    row.subtitleLabel.text = _('GNOME did not turn it on: check that extensions are on in the Extensions app');
            } else if (action) {
                // the browser opens above the panel: the panel goes
                ctx.closePanel();
                try {
                    Gio.AppInfo.launch_default_for_uri(action, null);
                } catch (e) {
                    logError(`cannot open ${action}: ${e}`);
                }
            }
        },
    });
    button.x_expand = false;
    button.y_align = Clutter.ActorAlign.CENTER;
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

// The settings of section `id`, or null when the card has no such section.
// closePanel: closes the panel (before a browser opens)
export function buildSectionPage(settings, id, {closePanel}) {
    const section = hubSections().find(s => s.id === id);
    if (!section)
        return null;
    const env = {bii: biiState()};
    const syncs = [];
    const ctx = {settings, env, syncs, closePanel};
    const pieces = [];
    for (const group of section.groups) {
        // the groups each place builds itself: not in the card yet
        if (group.custom)
            continue;
        const rows = group.rows.flatMap(row => modelRows(row, ctx));
        if (!rows.length)
            continue;
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
        pieces.push(kit.card(rows));
    }
    const page = kit.page(pieces);
    const sync = () => syncs.forEach(fn => fn());
    sync();
    const settingsId = settings.connect('changed', sync);
    const extId = Main.extensionManager.connect('extension-state-changed', (_m, ext) => {
        if (ext?.uuid !== BII_UUID)
            return;
        env.bii = biiState();
        sync();
    });
    page.connect('destroy', () => {
        settings.disconnect(settingsId);
        Main.extensionManager.disconnect(extId);
    });
    return page;
}
