// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// One place for the messages the extension writes to the system log, all
// with the same prefix, so they are easy to find with journalctl.

const PREFIX = 'Smart Calendar Hub:';

export function logError(message) {
    console.error(`${PREFIX} ${message}`);
}

export function logWarning(message) {
    console.warn(`${PREFIX} ${message}`);
}
