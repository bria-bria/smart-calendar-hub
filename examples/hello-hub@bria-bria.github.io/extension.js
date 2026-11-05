// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Example for Smart Calendar Hub: an ordinary top bar icon with an ordinary
// menu (what users without the hub see), plus the optional `smartCalendarHub`
// description that the hub reads when the icon is in its tray.

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

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
            // a page of our own, built at every visit and destroyed after it
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
    }

    disable() {
        this._button?.destroy();
        this._button = null;
    }
}
