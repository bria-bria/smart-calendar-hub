// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The widgets in the side panel, in the order of the active profile
// (sch-widgets.js). The hub's own widgets are built once with the panel: one
// switched off is taken out of the panel and put back when switched on. The
// widgets of other extensions are built when switched on, inside a card of
// ours (same margins and corners as the rest of the panel), and destroyed
// when switched off, removed or when the panel goes; one that fails to build
// is left out. One the profile shows but whose extension is not there (yet)
// leaves an empty card with its name. Only one widget fills the free room:
// the notifications when they are shown, otherwise the first 'fill' widget.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';
import {HUB_WIDGETS, widgetOrder} from './sch-widgets.js';

export class PanelWidgets {
    // hub: id → the actors of that hub widget, already in the sidebar
    constructor(panel, hub, registry) {
        this._panel = panel;
        this._hub = hub;
        this._registry = registry;
        // hub actors taken out of the panel → whether they were visible
        // (Clutter shows an actor again when it gets a parent)
        this._parked = new Map();
        this._external = new Map(); // id → {spec, actor} built (actor null: failed)
        registry.onChanged = () => this.place();
    }

    // Everything back in the sidebar, to go with it (disable, lock screen)
    destroy() {
        this._registry.onChanged = null;
        for (const {actor} of this._external.values())
            actor?.destroy();
        this._external.clear();
        const sidebar = this._panel.sidebar;
        for (const actor of this._parked.keys())
            sidebar?.add_child(actor);
        this._parked.clear();
    }

    // The sidebar is being destroyed by GNOME Shell (logout): what we took
    // out of it goes the same way
    forget() {
        this._registry.onChanged = null;
        for (const actor of this._parked.keys())
            actor.destroy();
        this._parked.clear();
        this._external.clear();
    }

    place() {
        const sidebar = this._panel.sidebar;
        if (!sidebar)
            return;
        const order = widgetOrder(this._panel.settings, this._registry.ids);
        const shown = new Set(order.filter(w => w.on).map(w => w.id));
        let fillTaken = shown.has('notifications') && (this._hub.get('notifications')?.length ?? 0) > 0;
        let index = 0;
        for (const {id, on} of order) {
            const hub = HUB_WIDGETS.includes(id);
            const actors = hub ? this._hubActors(id, on) : this._externalActors(id, on);
            const fill = !hub && this._registry.get(id)?.size === 'fill';
            for (const actor of actors) {
                if (fill) {
                    actor.y_expand = !fillTaken;
                    fillTaken = true;
                }
                if (actor.get_parent() !== sidebar) {
                    sidebar.add_child(actor);
                    if (this._parked.has(actor))
                        actor.visible = this._parked.get(actor);
                }
                this._parked.delete(actor);
                sidebar.set_child_at_index(actor, index++);
            }
        }
        // no longer in the profile at all (e.g. the profile was reset)
        for (const [id, {actor}] of this._external) {
            if (!order.some(w => w.id === id)) {
                actor?.destroy();
                this._external.delete(id);
            }
        }
    }

    // The actors of a hub widget to show (none when switched off: taken out)
    _hubActors(id, on) {
        const actors = this._hub.get(id) ?? [];
        if (on)
            return actors;
        for (const actor of actors) {
            if (!actor.get_parent())
                continue;
            this._parked.set(actor, actor.visible);
            actor.get_parent().remove_child(actor);
        }
        return [];
    }

    _externalActors(id, on) {
        const spec = this._registry.get(id);
        const built = this._external.get(id);
        if (built && (!on || built.spec !== spec)) {
            built.actor?.destroy();
            this._external.delete(id);
        }
        if (!on)
            return [];
        if (!spec)
            return [this._missingCard(id)];
        if (!this._external.has(id))
            this._external.set(id, {spec, actor: this._build(spec)});
        const {actor} = this._external.get(id);
        return actor ? [actor] : [];
    }

    // The widget of another extension in a card of ours; null if it fails
    _build(spec) {
        let child;
        try {
            child = spec.build();
        } catch (e) {
            logError(`widget ${spec.id}: ${e}`);
            return null;
        }
        if (!(child instanceof Clutter.Actor) || child.get_parent()) {
            logError(`widget ${spec.id}: build() must return an actor without a parent`);
            return null;
        }
        const card = new St.Bin({
            style_class: `sch-widget sch-widget-${spec.size}`,
            x_expand: true,
            child,
        });
        child.x_expand = true;
        child.y_expand = spec.size === 'fill';
        return card;
    }

    // The widget's extension is not there: an empty card with its name, kept
    // until the extension adds the widget again
    _missingCard(id) {
        const old = this._external.get(id);
        if (old?.actor && !old.spec)
            return old.actor;
        const card = new St.Bin({
            style_class: 'sch-widget sch-widget-card sch-widget-missing',
            x_expand: true,
            child: new St.Label({text: _('{title} · not available', {title: this._registry.title(id)})}),
        });
        this._external.set(id, {spec: null, actor: card});
        return card;
    }
}
