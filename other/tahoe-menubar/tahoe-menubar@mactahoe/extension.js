import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DARK_CONTENT = 'menubar-dark-content';
const LIGHT_CONTENT = 'menubar-light-content';

// Luminance at which black and white text reach the same WCAG contrast ratio
// against the background: (L + 0.05) / 0.05 = 1.05 / (L + 0.05).
const CONTRAST_CROSSOVER = 0.179;

const SAMPLE_WIDTH = 512;

// macOS draws third-party menu bar items as monochrome templates tinted to the
// bar. Tray apps ship fixed-colour icons instead (Dropbox even loads its own
// image directory under a PID-suffixed id, so per-app custom icons cannot
// target it), so the AppIndicator extension's desaturate + brightness effect
// is the only hook that reaches all of them.
const APPINDICATOR_SCHEMA = 'org.gnome.shell.extensions.appindicator';
const TRAY_BRIGHTNESS = {
    [DARK_CONTENT]: -0.8,
    [LIGHT_CONTENT]: 0.8,
};

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
        this._update();
    }

    disable() {
        this._cancellable.cancel();
        for (const [object, id] of this._connections)
            object.disconnect(id);
        this._setContent(null);

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
}
