import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DARK_CONTENT = 'menubar-dark-content';
const LIGHT_CONTENT = 'menubar-light-content';

// Luminance at which black and white text reach the same WCAG contrast ratio
// against the background: (L + 0.05) / 0.05 = 1.05 / (L + 0.05).
const CONTRAST_CROSSOVER = 0.179;

const SAMPLE_WIDTH = 512;

// macOS draws third-party menu bar items as monochrome templates tinted to the
// bar. Tray apps ship fixed-colour icons instead, so the AppIndicator
// extension's desaturate + brightness effect recolours all of them, and its
// custom-icons setting swaps the filled glyphs for line icons.
const APPINDICATOR_SCHEMA = 'org.gnome.shell.extensions.appindicator';
// Full ±1 turns every opaque pixel solid black or white, i.e. a template image
// matching the status icons.
const TRAY_BRIGHTNESS = {
    [DARK_CONTENT]: -1.0,
    [LIGHT_CONTENT]: 1.0,
};

const SNI_WATCHER = 'org.kde.StatusNotifierWatcher';
const SNI_WATCHER_PATH = '/StatusNotifierWatcher';
const SNI_ITEM = 'org.kde.StatusNotifierItem';

// Matched by prefix because Dropbox appends its PID to its tray id, which
// rules out a static custom-icons entry.
const TRAY_ICON_REPLACEMENTS = [
    {idPrefix: 'dropbox-client-', iconName: 'dropbox-symbolic'},
    {idPrefix: 'livepatch', iconName: 'app-safety-ok-symbolic'},
    {idPrefix: 'unattended-upgrade', iconName: 'software-update-available-symbolic'},
    // No icon theme ships a line WhatsApp glyph, so it is bundled here.
    {idPrefix: 'whatsdesk_status_icon', iconFile: 'icons/whatsapp-symbolic.svg'},
    {idPrefix: 'CopyQ_', iconName: 'clipboard-outline-symbolic'},
];

// AppIndicator creates the panel button only after reading a new item's
// properties, so replacing right on registration would miss it.
const TRAY_REPLACE_DELAY_MS = 1000;

Gio._promisify(Gio.DBusConnection.prototype, 'call');

function findReplacement(id) {
    return TRAY_ICON_REPLACEMENTS.find(({idPrefix}) => id.startsWith(idPrefix));
}

// Apps that pass their own IconThemePath (Dropbox, WhatsDesk) make
// AppIndicator look custom icon *names* up only in that path, so the
// replacement has to be an absolute file path from the active icon theme.
function resolveIconPath(iconName) {
    const iconInfo = new St.IconTheme().lookup_icon_for_scale(iconName, 16, 1, 0);
    return iconInfo?.get_filename() ?? null;
}

// Must stay async: the StatusNotifierWatcher lives inside gnome-shell itself
// (AppIndicator), so a synchronous call blocks the shell until it times out.
async function getDBusProperty(busName, objectPath, iface, property) {
    const reply = await Gio.DBus.session.call(busName, objectPath,
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [iface, property]),
        new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, -1, null);
    return reply.recursiveUnpack()[0];
}

function findIconActors(actor, found = []) {
    if (actor._customIcons)
        found.push(actor);
    for (const child of actor.get_children?.() ?? [])
        findIconActors(child, found);
    return found;
}

// The watcher lists items as "bus.name" or, for Ayatana ones, "bus.name@/path".
function splitItemAddress(address) {
    const at = address.indexOf('@');
    return at < 0
        ? [address, '/StatusNotifierItem']
        : [address.slice(0, at), address.slice(at + 1)];
}

function linearize(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r, g, b) {
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

// 'zoom' (the GNOME default) scales the image to cover the monitor and crops
// it centred. 'centered', 'scaled', 'wallpaper' and 'spanned' are treated the
// same way: they are rare, and the error only shifts which strip gets sampled.
function menuBarRegion(imageWidth, imageHeight, monitor, barHeight, pictureOptions) {
    if (pictureOptions === 'stretched') {
        const height = Math.round(imageHeight * barHeight / monitor.height);
        return {x: 0, y: 0, width: imageWidth, height: Math.max(1, height)};
    }

    const scale = Math.max(monitor.width / imageWidth, monitor.height / imageHeight);
    const visibleWidth = monitor.width / scale;
    const visibleHeight = monitor.height / scale;
    return {
        x: Math.floor((imageWidth - visibleWidth) / 2),
        y: Math.floor((imageHeight - visibleHeight) / 2),
        width: Math.min(imageWidth, Math.floor(visibleWidth)),
        height: Math.max(1, Math.round(barHeight / scale)),
    };
}

function averageLuminance(pixbuf, region) {
    const pixels = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const channels = pixbuf.get_n_channels();
    const lastRow = Math.min(region.y + region.height, pixbuf.get_height());
    const lastColumn = Math.min(region.x + region.width, pixbuf.get_width());

    let sum = 0;
    let count = 0;
    for (let y = Math.max(0, region.y); y < lastRow; y++) {
        for (let x = Math.max(0, region.x); x < lastColumn; x++) {
            const i = y * rowstride + x * channels;
            sum += relativeLuminance(pixels[i], pixels[i + 1], pixels[i + 2]);
            count++;
        }
    }
    return count > 0 ? sum / count : null;
}

export default class TahoeMenuBarExtension extends Extension {
    enable() {
        this._backgroundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._traySettings = Gio.SettingsSchemaSource.get_default().lookup(APPINDICATOR_SCHEMA, true)
            ? new Gio.Settings({schema_id: APPINDICATOR_SCHEMA})
            : null;
        this._cancellable = new Gio.Cancellable();
        this._connections = [
            [this._backgroundSettings, this._backgroundSettings.connect('changed', () => this._update())],
            [this._interfaceSettings, this._interfaceSettings.connect('changed::color-scheme', () => this._update())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._update())],
        ];
        this._trayItemSubscription = Gio.DBus.session.signal_subscribe(null, SNI_WATCHER,
            'StatusNotifierItemRegistered', SNI_WATCHER_PATH, null, Gio.DBusSignalFlags.NONE,
            () => this._scheduleTrayIconReplacement());
        this._watchedIconActors = new Map();
        this._update();
        this._replaceTrayIcons();
    }

    disable() {
        this._cancellable.cancel();
        for (const [object, id] of this._connections)
            object.disconnect(id);
        Gio.DBus.session.signal_unsubscribe(this._trayItemSubscription);
        if (this._replaceSourceId)
            GLib.source_remove(this._replaceSourceId);
        for (const [actor, handlerId] of this._watchedIconActors)
            actor.disconnect(handlerId);
        this._setContent(null);
        if (this._traySettings)
            this._setTrayIconReplacements([]);

        this._trayItemSubscription = 0;
        this._replaceSourceId = 0;
        this._watchedIconActors = null;
        this._connections = null;
        this._cancellable = null;
        this._traySettings = null;
        this._interfaceSettings = null;
        this._backgroundSettings = null;
    }

    _wallpaperUri() {
        const preferDark = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        return this._backgroundSettings.get_string(preferDark ? 'picture-uri-dark' : 'picture-uri');
    }

    _update() {
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        const monitor = Main.layoutManager.primaryMonitor;
        const pictureOptions = this._backgroundSettings.get_string('picture-options');
        if (!monitor || pictureOptions === 'none') {
            this._setContent(null);
            return;
        }

        const file = Gio.File.new_for_uri(this._wallpaperUri());
        file.read_async(GLib.PRIORITY_LOW, cancellable, (_file, readResult) => {
            let stream;
            try {
                stream = file.read_finish(readResult);
            } catch (error) {
                this._onLoadFailed(error);
                return;
            }

            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, SAMPLE_WIDTH, -1, true, cancellable, (_source, pixbufResult) => {
                let pixbuf;
                try {
                    pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(pixbufResult);
                } catch (error) {
                    this._onLoadFailed(error);
                    return;
                } finally {
                    stream.close(null);
                }

                const barHeight = Math.max(1, Main.panel.height);
                const region = menuBarRegion(pixbuf.get_width(), pixbuf.get_height(), monitor, barHeight, pictureOptions);
                const luminance = averageLuminance(pixbuf, region);
                if (luminance === null)
                    this._setContent(null);
                else
                    this._setContent(luminance > CONTRAST_CROSSOVER ? DARK_CONTENT : LIGHT_CONTENT);
            });
        });
    }

    _onLoadFailed(error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return;

        // Slideshow XML wallpapers and unreadable files land here; the theme's
        // own per-variant colours are the safest fallback.
        console.warn(`${this.metadata.uuid}: cannot sample wallpaper: ${error.message}`);
        this._setContent(null);
    }

    _setContent(className) {
        Main.panel.remove_style_class_name(DARK_CONTENT);
        Main.panel.remove_style_class_name(LIGHT_CONTENT);
        if (className)
            Main.panel.add_style_class_name(className);
        this._tintTrayIcons(className);
    }

    _tintTrayIcons(className) {
        if (!this._traySettings)
            return;

        // Resetting instead of restoring a snapshot: a session that ends without
        // disable() would otherwise leave the tint behind as the "original".
        if (className) {
            this._traySettings.set_double('icon-saturation', 1.0);
            this._traySettings.set_double('icon-brightness', TRAY_BRIGHTNESS[className]);
        } else {
            this._traySettings.reset('icon-saturation');
            this._traySettings.reset('icon-brightness');
        }
    }

    async _replaceTrayIcons() {
        if (!this._traySettings)
            return;

        let addresses;
        try {
            addresses = await getDBusProperty(SNI_WATCHER, SNI_WATCHER_PATH, SNI_WATCHER,
                'RegisteredStatusNotifierItems');
        } catch (error) {
            console.warn(`${this.metadata.uuid}: cannot list tray items: ${error.message}`);
            return;
        }

        const replacements = [];
        for (const address of addresses) {
            const [busName, objectPath] = splitItemAddress(address);
            let id;
            try {
                id = await getDBusProperty(busName, objectPath, SNI_ITEM, 'Id');
            } catch {
                continue; // the item went away while we were asking
            }

            const replacement = findReplacement(id);
            const iconPath = replacement && this._resolveReplacementPath(replacement);
            if (iconPath)
                replacements.push([id, iconPath, '']);
        }

        // disable() may have run while the D-Bus calls were in flight.
        if (!this._traySettings)
            return;

        this._setTrayIconReplacements(replacements);
        this._watchReplacedIconActors();
    }

    _resolveReplacementPath({iconFile, iconName}) {
        return iconFile
            ? GLib.build_filenamev([this.path, iconFile])
            : resolveIconPath(iconName);
    }

    _scheduleTrayIconReplacement() {
        if (this._replaceSourceId)
            return;

        this._replaceSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TRAY_REPLACE_DELAY_MS, () => {
            this._replaceSourceId = 0;
            this._replaceTrayIcons();
            return GLib.SOURCE_REMOVE;
        });
    }

    // AppIndicator draws pixmap-only items (CopyQ) as the icon actor's own
    // St.ImageContent and never clears it when a custom icon later sets a
    // gicon, so the old pixmap keeps painting under the replacement.
    _watchReplacedIconActors() {
        for (const button of Object.values(Main.panel.statusArea)) {
            const id = button?._indicator?.id;
            if (!id || !findReplacement(id))
                continue;

            for (const actor of findIconActors(button)) {
                this._dropStalePixmap(actor);
                if (this._watchedIconActors.has(actor))
                    continue;

                this._watchedIconActors.set(actor,
                    actor.connect('notify::gicon', () => this._dropStalePixmap(actor)));
                actor.connect('destroy', () => this._watchedIconActors?.delete(actor));
            }
        }
    }

    _dropStalePixmap(actor) {
        if (actor.gicon && actor.content)
            actor.content = null;
    }

    // Keeps any custom-icons entries the user set by hand; only entries whose
    // id matches TRAY_ICON_REPLACEMENTS belong to this extension.
    _setTrayIconReplacements(replacements) {
        const current = this._traySettings.get_value('custom-icons').deepUnpack();
        const userEntries = current.filter(([id]) => !findReplacement(id));
        const entries = [...userEntries, ...replacements];
        if (JSON.stringify(entries) !== JSON.stringify(current))
            this._traySettings.set_value('custom-icons', new GLib.Variant('a(sss)', entries));
    }
}
