// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The signals a piece of the panel connects, disconnected all together when
// it goes. connectObject() (GNOME Shell) also forgets them by itself when the
// object they are connected to is destroyed.

export class Connections {
    constructor() {
        this._objects = new Set();
    }

    // obj.connect for each pair: connect(obj, 'signal', handler, …)
    connect(obj, ...signalsAndHandlers) {
        obj.connectObject(...signalsAndHandlers, this);
        this._objects.add(obj);
    }

    disconnectAll() {
        for (const obj of this._objects)
            obj.disconnectObject(this);
        this._objects.clear();
    }
}
