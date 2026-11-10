// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The profiles of the panel, without pieces of the screen. A profile says
// which widgets are on and in which order (sch-widgets.js), which buttons the
// bottom row shows and what each does, its name and the colour of the
// settings button. They are kept in GSettings (key profiles, one a{sv} each:
// id, name, color, widgets, off, buttons), with the one in use in
// active-profile. "Default" always exists and cannot be deleted (it can be
// renamed). The lock
// (profile-locked) keeps the profile chosen by hand: the automatic changes,
// when they come, leave it alone.

import GLib from 'gi://GLib';

import {_} from './sch-i18n.js';

export const DEFAULT_PROFILE = 'default';

// The colours the settings button can take, GNOME's palette
export const PROFILE_COLORS = [
    ['blue', '#3584e4'],
    ['green', '#33d17a'],
    ['yellow', '#f6d32d'],
    ['orange', '#ff7800'],
    ['red', '#e01b24'],
    ['purple', '#9141ac'],
];

export function colorLabel(color) {
    switch (color) {
    case 'blue': return _('Blue');
    case 'green': return _('Green');
    case 'yellow': return _('Yellow');
    case 'orange': return _('Orange');
    case 'red': return _('Red');
    case 'purple': return _('Purple');
    default: return _('No colour');
    }
}

export function colorValue(color) {
    return PROFILE_COLORS.find(([name]) => name === color)?.[1] ?? null;
}

// The three places of the bottom row; today's buttons for a profile that
// never chose
export const BUTTON_SLOTS = 3;
export const DEFAULT_BUTTONS = ['clocks', 'new-event', 'clear'];

const V = (type, value) => new GLib.Variant(type, value);
const str = value => (value instanceof GLib.Variant && value.get_type_string() === 's' ? value.unpack() : null);
const strv = value => (value instanceof GLib.Variant && value.get_type_string() === 'as' ? value.deepUnpack() : null);

// The profiles as GSettings gives them ({key: GLib.Variant} each), with
// "Default" in front when the list does not have it
function rawProfiles(settings) {
    const list = settings.get_value('profiles').deepUnpack();
    return list.some(p => str(p.id) === DEFAULT_PROFILE) ? list : [{id: V('s', DEFAULT_PROFILE)}, ...list];
}

function write(settings, list) {
    settings.set_value('profiles', V('aa{sv}', list));
}

// "Default" keeps its translated name until it is given one
function nameOf(raw) {
    return str(raw.name) || (str(raw.id) === DEFAULT_PROFILE ? _('Default') : _('Profile'));
}

// [{id, name, color}], "Default" first
export function profileList(settings) {
    return rawProfiles(settings).filter(p => str(p.id)).map(p => ({
        id: str(p.id), name: nameOf(p), color: str(p.color) ?? '',
    }));
}

export function activeProfileId(settings) {
    const active = settings.get_string('active-profile');
    return rawProfiles(settings).some(p => str(p.id) === active) ? active : DEFAULT_PROFILE;
}

// One profile, read: {id, name, color, widgets, off, buttons}; the active one
// when id is not given or not found
export function readProfile(settings, id = null) {
    const list = rawProfiles(settings);
    const wanted = id ?? activeProfileId(settings);
    const raw = list.find(p => str(p.id) === wanted) ?? list.find(p => str(p.id) === activeProfileId(settings));
    const buttons = strv(raw.buttons) ?? DEFAULT_BUTTONS;
    return {
        id: str(raw.id),
        name: nameOf(raw),
        color: str(raw.color) ?? '',
        widgets: strv(raw.widgets) ?? [],
        off: strv(raw.off) ?? [],
        buttons: Array.from({length: BUTTON_SLOTS}, (_v, i) => buttons[i] ?? 'none'),
    };
}

// Changes some fields of a profile (strings or lists of strings), keeping
// the others
export function updateProfile(settings, id, fields) {
    const list = rawProfiles(settings);
    const index = list.findIndex(p => str(p.id) === id);
    if (index < 0)
        return;
    const profile = {...list[index]};
    for (const [key, value] of Object.entries(fields))
        profile[key] = Array.isArray(value) ? V('as', value) : V('s', value);
    list[index] = profile;
    write(settings, list);
}

export function setActiveProfile(settings, id) {
    if (settings.get_string('active-profile') !== id)
        settings.set_string('active-profile', id);
}

// A copy of the profile in use, with a new name, which becomes the one in
// use; its id
export function createProfile(settings, name) {
    const list = rawProfiles(settings);
    const source = list.find(p => str(p.id) === activeProfileId(settings));
    const id = `profile-${GLib.uuid_string_random().slice(0, 8)}`;
    list.push({...source, id: V('s', id), name: V('s', name)});
    write(settings, list);
    setActiveProfile(settings, id);
    return id;
}

// A new name like "Profile 2", not yet used
export function newProfileName(settings) {
    const names = new Set(profileList(settings).map(p => p.name));
    let n = profileList(settings).length + 1;
    while (names.has(_('Profile {n}', {n})))
        n++;
    return _('Profile {n}', {n});
}

// "Default" stays; deleting the profile in use goes back to "Default"
export function deleteProfile(settings, id) {
    if (id === DEFAULT_PROFILE)
        return;
    const active = activeProfileId(settings);
    write(settings, rawProfiles(settings).filter(p => str(p.id) !== id));
    if (active === id)
        setActiveProfile(settings, DEFAULT_PROFILE);
}

// The actions a button of the bottom row can have: a closed list, no
// commands. 'app:<desktop id>' opens that app.
export const BUTTON_ACTIONS = ['none', 'new-event', 'clear', 'clocks', 'app', 'hub-settings', 'hub-updates',
    'hub-profiles', 'dnd'];

export function actionKind(action) {
    return action.startsWith('app:') ? 'app' : action;
}

export function actionLabel(action) {
    switch (actionKind(action)) {
    case 'new-event': return _('New event');
    case 'clear': return _('Clear notifications');
    case 'clocks': return _('World clocks');
    case 'app': return _('Open an app');
    case 'hub-settings': return _('Settings of the hub');
    case 'hub-updates': return _('System updates');
    case 'hub-profiles': return _('Change profile');
    case 'dnd': return _('Do not disturb');
    default: return _('None');
    }
}
