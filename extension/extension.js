// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Smart Calendar Hub: turns the date menu into a side panel (sch-side-panel.js)
// and gives the top bar its look (sch-topbar-style.js).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AlarmWatch} from './sch-alarm-watch.js';
import {SidePanel} from './sch-side-panel.js';
import {TopBarStyle} from './sch-topbar-style.js';
import {pageKit} from './sch-page-kit.js';
import {stopTimerCountdowns} from './sch-world-clocks.js';
import {forgetUpdatesCheck} from './sch-updates.js';
import {forgetInstalledVersion} from './sch-version-check.js';

export default class SmartCalendarHubExtension extends Extension {
    enable() {
        this._topBarStyle = new TopBarStyle(this.getSettings());
        // also on the lock screen, where it shows nothing: alarms ring there too
        if (!Main.sessionMode.isGreeter)
            this._alarmWatch = new AlarmWatch(this.getSettings());
        this._modeId = Main.sessionMode.connect('updated', () => this._syncSessionMode());
        // A failure while building the panel is reported to GNOME (the
        // Extensions app shows the error): the top bar style is undone too,
        // since GNOME does not call disable() after a failed enable().
        try {
            this._syncSessionMode();
        } catch (e) {
            this.disable();
            throw e;
        }
    }

    // Two levels, hence session-modes user and unlock-dialog in metadata.json.
    // The look of the top bar (accent colour, space between the icons, on the
    // login screen the clock position) is kept on every screen: session, lock
    // screen, login screen. Everything else (side panel, notifications,
    // calendar, tray, IP addresses…) only in the user session: it is taken
    // down when the screen locks, so nothing personal shows, and nothing
    // listens to the keyboard there; it is built again on unlock.
    disable() {
        if (this._modeId)
            Main.sessionMode.disconnect(this._modeId);
        this._modeId = 0;
        this._panel?.destroy();
        this._panel = null;
        this._alarmWatch?.destroy();
        this._alarmWatch = null;
        stopTimerCountdowns();
        forgetUpdatesCheck();
        forgetInstalledVersion();
        this._topBarStyle?.destroy();
        this._topBarStyle = null;
    }

    _syncSessionMode() {
        const session = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        // Back in the session: the clock first goes back where GNOME had it,
        // then the panel places it (the other order would move it back after
        // the panel placed it). Lock and login screen: the panel leaves
        // first, then the clock is placed.
        if (session)
            this._topBarStyle.setClockPlacement(false);
        if (session && !this._panel) {
            this._panel = new SidePanel(Main.panel.statusArea.dateMenu, this.getSettings(),
                this.metadata['version-name']);
        } else if (!session && this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
        if (!session)
            this._topBarStyle.setClockPlacement(true);
    }

    // For other extensions (see README, "For extension developers"): every
    // call answers false while the panel is not there (lock screen, the
    // extension switched off)

    showExternalPage(options) {
        return this._panel?.pages.showExternalPage(options) ?? false;
    }

    showPageMessage(id, text, seconds) {
        return this._panel?.pages.showPageMessage(id, text, seconds) ?? false;
    }

    setSideCount(id, count) {
        return this._panel?.pages.setSideCount(id, count) ?? false;
    }

    updateExternalPage(id, contents) {
        return this._panel?.pages.updateExternalPage(id, contents) ?? false;
    }

    // The standard pieces for the pages of other extensions (sch-page-kit.js)
    get pageKit() {
        return pageKit;
    }

    // What showExternalPage supports beyond the page itself (read only):
    // 'side' = buildSidePage, a card beside the panel
    get externalPageFeatures() {
        return Object.freeze(['side', 'side-header', 'kit', 'message', 'side-count', 'update']);
    }
}
