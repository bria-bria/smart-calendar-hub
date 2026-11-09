// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Example for Smart Calendar Hub: an ordinary top bar icon with an ordinary
// menu (what users without the hub see), plus the optional `smartCalendarHub`
// description that the hub reads when the icon is in its tray, and a widget
// for the hub's panel (it starts switched off: the user turns it on in
// Settings → Panel sections).

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const HUB = 'smart-calendar-hub@bria-bria.github.io';
const WIDGET_ID = 'hello-hub';

export default class HelloHubExtension extends Extension {
    enable() {
        this._button = new PanelMenu.Button(0.5, 'Hello Hub');
        this._button.add_child(new St.Icon({
            icon_name: 'face-smile-symbolic',
            style_class: 'system-status-icon',
        }));

        // 1. The normal menu: shown floating without the hub, and inside the
        //    hub when no page is given. It needs at least one item.
        this._button.menu.addMenuItem(new PopupMenu.PopupMenuItem('Hello from the menu'));

        // 2. Optional: how the hub shows this icon. Only read by the hub.
        let clicks = 0;
        this._button.smartCalendarHub = {
            title: 'Hello Hub',
            // a page of our own, built on every visit and destroyed after it
            buildPage: () => {
                const page = new St.BoxLayout({
                    orientation: 1, // vertical
                    style_class: 'hello-hub-page',
                    x_expand: true,
                });
                const label = new St.Label({text: `Clicked ${clicks} times`});
                const button = new St.Button({
                    label: 'Click me',
                    style_class: 'button',
                    can_focus: true,
                });
                button.connect('clicked', () => {
                    clicks++;
                    label.text = `Clicked ${clicks} times`;
                });
                page.add_child(label);
                page.add_child(button);
                // free timers or signals here
                page.connect('destroy', () => {});
                return page;
            },
            // true: the hub leaves our backgrounds alone
            keepStyle: false,
        };

        Main.panel.addToStatusArea(this.uuid, this._button);

        // 3. Optional: a widget in the hub's panel. The hub may start after
        //    us, or be switched off and on: add it whenever it is active.
        this._hubId = Main.extensionManager.connect('extension-state-changed', (_m, ext) => {
            if (ext.uuid === HUB && ext.state === ExtensionState.ACTIVE)
                this._addToHub();
        });
        this._addToHub();
    }

    _addToHub() {
        Main.extensionManager.lookup(HUB)?.stateObj?.addWidget?.({
            id: WIDGET_ID,
            title: 'Hello Hub',
            size: 'card',
            // a new actor each time the widget is shown; the hub destroys it
            build: () => new St.Label({text: 'Hello from a widget'}),
        });
    }

    disable() {
        Main.extensionManager.disconnect(this._hubId);
        this._hubId = 0;
        Main.extensionManager.lookup(HUB)?.stateObj?.removeWidget?.(WIDGET_ID);
        this._button?.destroy();
        this._button = null;
    }
}
