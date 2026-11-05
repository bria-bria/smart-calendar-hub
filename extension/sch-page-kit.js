// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The page kit: the standard pieces other extensions use to build their pages
// inside Smart Calendar Hub (showExternalPage, or a tray icon's buildPage),
// so every page has the same look as the panel — section titles, cards of
// rows, switches, pill buttons, an empty state. The look lives in our
// stylesheet (classes sch-kit-*): when it changes, every page follows.
// Exposed to other extensions as `stateObj.pageKit` (see README, "Page model").

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const VERTICAL = Clutter.Orientation.VERTICAL;

function iconOf(icon, size) {
    if (!icon)
        return null;
    const params = {icon_size: size, y_align: Clutter.ActorAlign.CENTER};
    if (typeof icon === 'string')
        params.icon_name = icon;
    else if (typeof icon?.to_string === 'function') // any Gio.Icon
        params.gicon = icon;
    else
        return null;
    return new St.Icon(params);
}

function label(text, styleClass) {
    const l = new St.Label({text: text ?? '', style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// The root of a page: the pieces one under the other, at the panel's
// spacing. Only one primary button per page: any other one is shown as a
// normal button.
function page(...children) {
    const box = new St.BoxLayout({orientation: VERTICAL, style_class: 'sch-kit-page', x_expand: true});
    for (const child of children.flat())
        if (child)
            box.add_child(child);
    let primary = false;
    const visit = actor => {
        for (const c of actor.get_children()) {
            if (c.has_style_class_name?.('sch-kit-button-primary')) {
                if (primary)
                    c.remove_style_class_name('sch-kit-button-primary');
                primary = true;
            }
            visit(c);
        }
    };
    visit(box);
    // pieces added later follow the same rule
    box.connect('child-added', (_box, child) => {
        const added = [child];
        const all = actor => {
            for (const c of actor.get_children())
                added.push(c), all(c);
        };
        all(child);
        for (const c of added) {
            if (!c.has_style_class_name?.('sch-kit-button-primary'))
                continue;
            if (primary)
                c.remove_style_class_name('sch-kit-button-primary');
            primary = true;
        }
    });
    return box;
}

// A small grey title above a group of rows
function section(title) {
    return label(title, 'sch-kit-section');
}

// A rounded card holding rows
function card(...rows) {
    const box = new St.BoxLayout({orientation: VERTICAL, style_class: 'sch-kit-card', x_expand: true});
    for (const row of rows.flat())
        if (row)
            box.add_child(row);
    return box;
}

// A row: icon, title, one line of detail, and on the right one thing only
// (a switch, a value or a chevron). With onActivate the whole row is a button.
// The labels can be changed later: row.titleLabel.text, row.subtitleLabel.text.
function row({icon = null, title = '', subtitle = '', trailing = null, onActivate = null} = {}) {
    const line = new St.BoxLayout({style_class: 'sch-kit-row-line', x_expand: true});
    const image = iconOf(icon, 18);
    if (image)
        line.add_child(image);
    const texts = new St.BoxLayout({orientation: VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const titleLabel = label(title, 'sch-kit-row-title');
    const subtitleLabel = label(subtitle, 'sch-kit-row-subtitle');
    subtitleLabel.visible = !!subtitle;
    texts.add_child(titleLabel);
    texts.add_child(subtitleLabel);
    line.add_child(texts);
    if (trailing)
        line.add_child(trailing);

    let actor;
    if (onActivate || trailing?._schKitToggle) {
        actor = new St.Button({style_class: 'sch-kit-row', can_focus: true, x_expand: true, child: line});
        actor.connect('clicked', () => {
            if (trailing?._schKitToggle)
                trailing._schKitToggle();
            onActivate?.();
        });
    } else {
        actor = new St.Bin({style_class: 'sch-kit-row', x_expand: true, child: line});
    }
    actor.titleLabel = titleLabel;
    actor.subtitleLabel = subtitleLabel;
    actor.accessible_name = subtitle ? `${title}, ${subtitle}` : title;
    return actor;
}

// GNOME's own switch, for the trailing place of a row (the row toggles it).
// switch.state reads or sets it; onToggle(state) after each click.
function toggle({active = false, onToggle = null} = {}) {
    const sw = new PopupMenu.Switch(!!active);
    sw.reactive = false; // the row handles the click
    sw._schKitToggle = () => {
        sw.state = !sw.state;
        onToggle?.(sw.state);
    };
    return sw;
}

// A short value on the right of a row
function value(text) {
    return label(text, 'sch-kit-value');
}

// The chevron of a row that opens something
function chevron() {
    return iconOf('go-next-symbolic', 16);
}

// A pill button; primary = the accent colour (one per page)
function button({label: text = '', primary = false, onClick = null} = {}) {
    const btn = new St.Button({
        style_class: primary ? 'sch-kit-button sch-kit-button-primary' : 'sch-kit-button',
        label: text,
        can_focus: true,
        x_expand: true,
    });
    if (onClick)
        btn.connect('clicked', () => onClick());
    return btn;
}

// Buttons side by side, of the same width
function buttons(...btns) {
    const box = new St.BoxLayout({style_class: 'sch-kit-buttons', x_expand: true});
    for (const b of btns.flat())
        if (b)
            box.add_child(b);
    return box;
}

// Nothing to show: an icon and one sentence
function empty({icon = 'action-unavailable-symbolic', text = ''} = {}) {
    const box = new St.BoxLayout({orientation: VERTICAL, style_class: 'sch-kit-empty', x_expand: true});
    const image = iconOf(icon, 24);
    if (image) {
        image.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(image);
    }
    const l = label(text, 'sch-kit-empty-text');
    l.x_align = Clutter.ActorAlign.CENTER;
    l.clutter_text.line_wrap = true;
    l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    box.add_child(l);
    return box;
}

export const PAGE_KIT_VERSION = 1;

export const pageKit = Object.freeze({
    version: PAGE_KIT_VERSION,
    page, section, card, row, toggle, value, chevron, button, buttons, empty,
});
