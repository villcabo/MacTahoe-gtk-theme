import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const SETTINGS_APP = 'org.gnome.Settings.desktop';
const APP_STORE_APPS = ['snap-store_snap-store.desktop', 'org.gnome.Software.desktop'];
const PROCESS_MONITOR_APPS = ['net.nokyan.Resources.desktop', 'org.gnome.SystemMonitor.desktop'];

function lookupFirstApp(ids) {
    const appSystem = Shell.AppSystem.get_default();
    for (const id of ids) {
        const app = appSystem.lookup_app(id);
        if (app)
            return app;
    }
    return null;
}

// The theme draws the Apple logo on #panelActivities, in every content and
// overview variant, so this button takes that name instead of shipping a logo.
export const AppleMenuButton = GObject.registerClass(
class AppleMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Apple Menu');
        this.name = 'panelActivities';
        this.add_child(new St.Bin());

        const systemActions = SystemActions.getDefault();
        const menu = this.menu;

        menu.addAction('About This Computer', () => Util.spawn(['gnome-control-center', 'system', 'about']));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addAppItem('System Settings…', [SETTINGS_APP]);
        this._addAppItem('App Center…', APP_STORE_APPS);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addAppItem('Force Quit…', PROCESS_MONITOR_APPS);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addSystemItem('Sleep', 'can-suspend', () => systemActions.activateSuspend());
        this._addSystemItem('Restart…', 'can-restart', () => systemActions.activateRestart());
        this._addSystemItem('Shut Down…', 'can-power-off', () => systemActions.activatePowerOff());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addSystemItem('Lock Screen', 'can-lock-screen', () => systemActions.activateLockScreen());
        this._addSystemItem(`Log Out ${GLib.get_real_name()}…`, 'can-logout', () => systemActions.activateLogout());
    }

    _addAppItem(label, appIds) {
        const app = lookupFirstApp(appIds);
        if (app)
            this.menu.addAction(label, () => app.activate());
    }

    // Lockdown settings and the session can forbid an action at runtime.
    _addSystemItem(label, property, activate) {
        const item = this.menu.addAction(label, activate);
        SystemActions.getDefault().bind_property(property, item, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
    }
});

// macOS names the focused app in bold next to the Apple menu. GNOME apps do
// not export their menus on Wayland, so this one offers what every app has.
export const AppMenuButton = GObject.registerClass(
class AppMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'App Menu');
        this._label = new St.Label({
            style: 'font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._newWindowItem = this.menu.addAction('New Window', () => this._app?.open_new_window(-1));
        this._hideItem = this.menu.addAction('Hide', () => this._hideApp());
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._quitItem = this.menu.addAction('Quit', () => this._app?.request_quit());

        const tracker = Shell.WindowTracker.get_default();
        const focusAppId = tracker.connect('notify::focus-app', () => this._sync());
        this.connect('destroy', () => tracker.disconnect(focusAppId));
        this._tracker = tracker;
        this._sync();
    }

    _sync() {
        this._app = this._tracker.focus_app;
        this.visible = this._app !== null;
        if (!this._app)
            return;

        const name = this._app.get_name();
        this._label.text = name;
        this._newWindowItem.visible = this._app.can_open_new_window();
        this._hideItem.label.text = `Hide ${name}`;
        this._quitItem.label.text = `Quit ${name}`;
    }

    _hideApp() {
        for (const window of this._app?.get_windows() ?? [])
            window.minimize();
    }
});
