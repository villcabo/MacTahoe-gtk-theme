import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {UnlockDialog} from 'resource:///org/gnome/shell/ui/unlockDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// GNOME blurs the lock screen wallpaper with a fixed radius of 90 and dims it
// to 65 %. macOS keeps it sharp, dimmed just enough for the white text.
// Blur my Shell's lockscreen blur replaces the same method, so it must be off.
const BACKGROUND_BRIGHTNESS = 0.85;

// Only enabled in the unlock-dialog session mode (see metadata.json), so the
// user-session features of tahoe-menubar never run on the lock screen.
export default class TahoeLockScreenExtension extends Extension {
    enable() {
        this._updateBackgroundEffects = UnlockDialog.prototype._updateBackgroundEffects;
        UnlockDialog.prototype._updateBackgroundEffects = function () {
            for (const widget of this._backgroundGroup)
                widget.get_effect('blur')?.set({brightness: BACKGROUND_BRIGHTNESS, radius: 0});
        };

        // The dialog is created on every lock, sometimes before this runs.
        const shield = Main.screenShield;
        const ensureUnlockDialog = shield._ensureUnlockDialog;
        shield._ensureUnlockDialog = function (...args) {
            const result = ensureUnlockDialog.apply(this, args);
            putDateAboveTime(this._dialog);
            return result;
        };

        shield._dialog?._updateBackgroundEffects();
        putDateAboveTime(shield._dialog);
    }

    disable() {
        UnlockDialog.prototype._updateBackgroundEffects = this._updateBackgroundEffects;
        this._updateBackgroundEffects = null;
        // The override is an own property shadowing the prototype's method.
        delete Main.screenShield._ensureUnlockDialog;
        Main.screenShield._dialog?._updateBackgroundEffects();
    }
}

// macOS shows the date above the time; GNOME's clock adds the time first.
function putDateAboveTime(dialog) {
    const clock = dialog?._clock;
    if (clock?._date && clock._time)
        clock.set_child_below_sibling(clock._date, clock._time);
}
