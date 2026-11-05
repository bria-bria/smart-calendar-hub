// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Space between the icons of the top bar: the side padding of every
// panel button in the left, centre and right boxes, set INLINE on the
// button (other extensions set theirs inline too, and inline style wins
// over any stylesheet). The original inline style is kept and given back
// when the icon leaves the bar (e.g. moved into the side panel tray) or the
// extension is disabled. Same approach as the Status Area Horizontal Spacing
// extension. With the GNOME default (12 px) nothing is touched.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const GNOME_DEFAULT_SPACING = 12;

// set_style() alone does not make the panel button read its padding again:
// switching the style class away and back forces it (the same trick as
// Status Area Horizontal Spacing and Dash to Panel).
function refresh(button) {
    const classes = button.get_style_class_name();
    button.set_style_class_name('sch-spacing-refresh');
    button.set_style_class_name(classes);
}
// marker of our style: an unknown property, ignored by St
const MARK = '-sch-spacing: 1';

export class PanelSpacing {
    constructor(settings) {
        this._settings = settings;
        this._boxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox];
        this._boxIds = [];
        // button -> {style: original inline style, id: style-changed handler}
        this._buttons = new Map();
        this._settingId = settings.connect('changed::top-bar-spacing', () => this._applyAll());
        for (const box of this._boxes) {
            this._boxIds.push([box, box.connect('child-added', (_b, actor) => this._apply(actor))]);
            this._boxIds.push([box, box.connect('child-removed', (_b, actor) => this._restore(actor))]);
        }
        this._applyAll();
    }

    destroy() {
        this._settings.disconnect(this._settingId);
        for (const [box, id] of this._boxIds)
            box.disconnect(id);
        this._boxIds = [];
        for (const button of [...this._buttons.keys()])
            this._restoreButton(button);
        this._buttons.clear();
    }

    get _style() {
        const px = this._settings.get_int('top-bar-spacing');
        return `${MARK}; -natural-hpadding: ${px}px; -minimum-hpadding: ${Math.min(px, 6)}px`;
    }

    _applyAll() {
        for (const box of this._boxes) {
            for (const actor of box.get_children()) {
                this._restore(actor);
                this._apply(actor);
            }
        }
    }

    // The panel button is the container itself or its first child
    _buttonOf(actor) {
        if (actor?.has_style_class_name?.('panel-button'))
            return actor;
        const child = actor?.get_first_child?.();
        return child?.has_style_class_name?.('panel-button') ? child : null;
    }

    _apply(actor) {
        if (this._settings.get_int('top-bar-spacing') === GNOME_DEFAULT_SPACING)
            return;
        const button = this._buttonOf(actor);
        if (!button || this._buttons.has(button))
            return;
        const entry = {style: button.get_style(), id: 0, destroyId: 0};
        this._buttons.set(button, entry);
        const set = () => {
            const theirs = entry.style ? `${entry.style}; ` : '';
            // ours last, so it wins over theirs
            button.set_style(`${theirs}${this._style}`);
            refresh(button);
        };
        set();
        // another extension changed the style: keep theirs, ours again on top
        entry.id = button.connect('style-changed', () => {
            const current = button.get_style() ?? '';
            if (current.includes(MARK))
                return;
            entry.style = current || null;
            set();
        });
        entry.destroyId = button.connect('destroy', () => this._buttons?.delete(button));
    }

    _restore(actor) {
        const button = this._buttonOf(actor);
        if (button)
            this._restoreButton(button);
    }

    _restoreButton(button) {
        const entry = this._buttons.get(button);
        if (!entry)
            return;
        this._buttons.delete(button);
        try {
            button.disconnect(entry.id);
            button.disconnect(entry.destroyId);
            button.set_style(entry.style ?? null);
            refresh(button);
        } catch (_e) {
            // the button is already gone
        }
    }
}
