# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A personal fork of [vinceliuice/MacTahoe-gtk-theme](https://github.com/vinceliuice/MacTahoe-gtk-theme) whose goal is to make Ubuntu 26.04 / GNOME Shell 50 (Wayland) look like **macOS 26 Tahoe**, in both light and dark.

- Fork: `villcabo/MacTahoe-gtk-theme`, branch **`tahoe`** (default branch). One branch holds both variants: the SCSS compiles light and dark from the same sources, so never split work into per-variant branches.
- Remotes: `origin` = the fork, `upstream` = vinceliuice. Sync with `git fetch upstream && git rebase upstream/main` (a force-push follows).
- Sibling forks used by the same setup:
  - `villcabo/blur-my-shell`, branch `feat/dock-radius-from-theme`: obsolete. It made the static dock blur take its corner radius from the theme's `.dash-background` (issue aunetx/blur-my-shell#1064, PR #1065). Upstream closed the PR on 2026-10-07 because the refactor release does the same (#976, #1044). Blur my Shell v76 from extensions.gnome.org is installed now and already replaced the local build.
  - `villcabo/WhiteSur-gtk-theme`, branch `tahoe-mode`: the user's earlier, abandoned Tahoe experiment, kept for reference.

## Install on this machine

```bash
./install.sh --round --shell -i apple -h smaller   # all colours and opacities, plus the tahoe-menubar extension
./install.sh -l -c light -o solid --round --shell -i apple -h smaller   # libadwaita light + solid
```

- `-h smaller` gives a 36 px bar. `-h bigger` is 44 px here, because MacTahoe adds 2×6 px of pill padding to the panel height. The user found 44 px too tall: they prefer WhiteSur's 32 px.
- The installer sorts variants alphabetically, so `-l` always takes the first one (Dark, normal). Light + solid libadwaita therefore needs its own `-l -c light -o solid` run, which does not delete the other variants.
- Never use `-b` (blur variant), and avoid "normal" window opacity in light. Windows sit at 75% or 96% and nothing blurs behind app windows, so the text behind them ghosts through. Windows use the `-solid` variants.
- After installing, reload the shell theme with `dconf write /org/gnome/shell/extensions/user-theme/name "''"`, then write the real name back.
- New or changed **extension code** only loads after logging out and back in (Wayland).

## What the fork changes (and why)

- **Top bar** (`src/sass/gnome-shell/common/_panel.scss`): the `menubar-content` mixin and the `.menubar-dark-content` / `.menubar-light-content` classes. With no class, the light variant uses dark content.
  - Ubuntu keeps the Yaru stylesheet loaded under every user theme, and Yaru forces `#panel { background-color: #131313 !important }`, `.system-status-icon { color: #f2f2f2 !important }` and white workspace dots. Only a theme `!important` outranks them, which is why those rules carry it.
- **`tahoe-menubar@mactahoe` extension** (`other/tahoe-menubar/`), installed by `install.sh`:
  - It samples the wallpaper strip behind the bar and sets the content class. Dark content is used when the strip's luminance is above 0.179, the WCAG point where black and white text have equal contrast.
  - It tints AppIndicator tray icons as macOS-style templates: saturation 1 and brightness ±1.
  - It swaps filled tray glyphs for line icons (`TRAY_ICON_REPLACEMENTS`, matched by id prefix because Dropbox's id carries its PID). The WhatsApp glyph is bundled in `icons/`.
  - It works around an appindicators bug: pixmap-only items (CopyQ) keep their old `St.ImageContent` under a custom `gicon`, so the extension clears `content` on `notify::gicon`.
  - It replaces the Activities button with an Apple menu and adds the focused app's name in bold (`appleMenu.js`). The Apple button is named `panelActivities`, so it inherits the theme's logo in every content and overview variant. Power actions go through GNOME's `SystemActions`, which shows the confirmation dialogs and honours lockdown. App menus (File, Edit…) are not possible: see the global menu note below.
  - It moves the clock to the far right of the bar, the volume/brightness OSD under the bar's right end, and notification banners to the top right (`Main.messageTray.bannerAlignment`), as on macOS. `disable()` puts all three back.
  - A legacy XEmbed tray icon (shown as `appindicator-legacy:*`) cannot be tinted: the template effect paints its opaque background solid black. Qt apps fall back to XEmbed when they start before the StatusNotifierWatcher exists, so start them after it (the user's `keepassxc-autounlock` script waits for `org.kde.StatusNotifierWatcher`).
- **Quick settings toggles** follow macOS's Control Center: an active toggle keeps its glass module and lights its icon circle in the accent colour, in both variants. Every toggle gets the icon circle except the battery and background-apps buttons.
- **Dock running dots:** one dot per app (`running-indicator-style='DOT'` in dconf), all the same colour; the focused app's dot is no longer accent-coloured.
- **Dock** (`src/sass/_colors.scss` `$dash_bg` / `$dash_highlight`): the dock carries its own frost (light) or smoke (dark), so it reads as glass with or without Blur my Shell.
- **Quick settings** (`widgets-48-0/_quick-settings.scss`):
  - A light-glass palette: dark text and translucent white modules. Upstream's transparent palette assumed dark glass.
  - Compact slider rows.
- **Shared radius:** `$control_center_radius` (33 px) in `_variables.scss` is used by both quick settings and the calendar, because Blur my Shell clips both with a single radius.

## Environment gotchas (this machine)

- **`gsettings` on PATH is Homebrew's.** It silently writes to `~/.config/glib-2.0/settings/keyfile`, which GNOME never reads. Use `/usr/bin/gsettings` or `dconf`, and verify every change with `dconf read`.
- **Symbolic icons must be fill-only.** Symbolic rendering forces `fill`, so a `stroke` outline renders as a solid blob. Draw outlines as evenodd outer and inner shapes.
- **St caches icon textures by path.** A changed SVG at the same path shows the old image until re-login; test it under a new filename.
- **Never call the StatusNotifierWatcher synchronously** from inside gnome-shell. It lives in the shell (appindicators), so the call blocks the shell until the D-Bus timeout. Use async calls only.
- **kitty must run on X11** (`linux_display_server x11` in `kitty.conf`): on Wayland it draws its own titlebar with grey buttons on the right. On X11 its titlebar comes from `mutter-x11-frames`, gets the theme's traffic lights, and only re-themes after re-login.
- **Apps that draw their own titlebar** ignore the theme until set to a native frame: Telegram *Use system window frame*, Obsidian *Window frame style: Native*, Chrome theme *GTK*. Bruno has no such option.
  - VS Code stays on its own (custom) titlebar on purpose. `"window.titleBarStyle": "native"` gives traffic lights, but the menu then needs its own row, which takes too much height for the user; the hamburger menu only exists in the custom titlebar.
  - A macOS-style global menu (app menus in the top bar) is not an option on GNOME 50 Wayland: it needs apps to export their menus over D-Bus (dbusmenu), which Electron and GTK4 apps do not do there.
- **To capture without disturbing the session**, use `Shell.Screenshot` inside `Eval` (menus stay open) and `windowActor.get_image(null).writeToPNG(path)` for a single window, even an unfocused one.
- A "missing" audio device `>` button in quick settings is not a theme bug: GNOME shows it only with more than one *available* route (check with `pw-dump`, `EnumRoute`).

## Verifying visual changes

- Take screenshots yourself with `flameshot full -p <file>`; no prompt appears. The screen is 3840x1200 (two monitors), so crop with `magick`. Do not ask the user for screenshots.
- Menus (quick settings, calendar) close when the capture starts. Ask the user to run `flameshot full -d 5000 -p ~/Pictures` and open the menu within 5 s.
- To test blur edges, temporarily set an 8 px black/white checker wallpaper, then restore the original. On a smooth wallpaper, blur leaking past a corner is invisible.
- Live shell inspection: the user opens `lg` and runs `global.context.unsafe_mode = true`; then use `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '<js>'`. Turn it back off afterwards.

## Desktop configuration (lives in dconf, not in this repo)

- **Blur my Shell:**
  - Panel: blur on, brightness 0.85.
  - Popups: blur on, **static**. The radii match the theme: notification 14, menu 14, quick-settings 33, osd 24, dialog 40. The `pipeline_default_rounded` pipeline had to be re-added to `pipelines`.
  - Popups: `preserve-shell-theme=true`. Without it the popup style (default "automatic") adds `.bms-popup-background-{dark,light}` to `Main.uiGroup`, and Blur my Shell's stylesheet repaints every quick-settings toggle in GNOME blue with `!important` at higher specificity than the theme, so no theme rule can win.
  - Dock: blur on, **static**, using the "Rounded" pipeline with blur brightness 0.9. With 0.6 plus the theme's smoke, the dark dock went near-black.
  - Since v76 the dock blur reads its corner radius from the theme's `.dash-background` (28), so the pipeline needs no corner effect. Pipelines no longer accept a `corner` effect at all ("effect \"corner\" not found"): each component has its own `corner-radius` key.
  - Dynamic dock blur can never be rounded, because it uses a `DummyPipeline` with no corner effect.
- **Ubuntu Dock:**
  - `custom-background-color=false` and `transparency-mode=DEFAULT`, because its inline style overrode the theme.
  - `custom-theme-customize-running-dots=false`, because its dark dots were invisible on the dark dock.
  - `running-indicator-style='DOT'`: macOS shows one dot per running app; `DOTS` showed one per window.
- `light-style` extension disabled.
- **Spotlight:** Vicinae (user install in `~/.local`, systemd user service `vicinae`, GNOME extension `vicinae@dagimg-dot`) on `Super+Space` via custom keybinding `custom9` running `vicinae toggle`.
  - `Super+Space` was freed from `switch-input-source` (now only `XF86Keyboard`) and from IBus's `triggers`: with a single keyboard layout neither did anything. Do not give it back to them.
  - Avoid `Ctrl+Space`: VS Code and IDEs use it for completion.
  - Config in `~/.config/vicinae/settings.json`: themes `mactahoe-dark`/`mactahoe-light` (sources in `other/vicinae/`, copied to `~/.local/share/vicinae/themes/`), rounding 26, opacity 0.82, telemetry off, close on focus loss. Vicinae re-reads it only after `systemctl --user restart vicinae`.
  - Glass: Blur my Shell `applications` blurs only the whitelisted `vicinae` window (`enable-all=false`, static, pipeline "Rounded", `corner-radius=26` to match Vicinae's rounding). A window that already exists keeps its old blur, so restart Vicinae after changing these.
  - Compact mode stays off: without layer-shell the window keeps its full size, so the blur paints an empty glass block under the search bar.
- **Wallpaper:** MacTahoe day (light) and night (dark), installed by `wallpaper/install-gnome-backgrounds.sh` into `~/.local/share/backgrounds/MacTahoe`. The WhiteSur-wallpapers collection is installed too.
  - That installer only copies the images. To make them show up in Settings → Appearance as light/dark pairs, they are registered in `~/.local/share/gnome-background-properties/macos-wallpapers.xml` (WhiteSur, Monterey, Ventura, Sonoma, plus the two originals).
- **Login screen (GDM):** installed with `sudo ./tweaks.sh -g -i apple -h smaller`.
  - On Ubuntu this overwrites `/usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource` (backup `.bak` next to it). That same file is the base stylesheet the Ubuntu session loads under user themes, so Yaru's forced panel `!important` rules are gone from it too.
  - Revert with `sudo ./tweaks.sh -g -r`.
  - A `yaru-theme-gnome-shell` package update restores Ubuntu's login, so re-run the command afterwards.
- **Light mode:** gtk `MacTahoe-Light-solid`, shell `MacTahoe-Light`, icons `MacTahoe-light`, color-scheme `default`.
- **Dark mode:** gtk `MacTahoe-Dark-solid`, shell `MacTahoe-Dark`, icons `MacTahoe-dark`, color-scheme `prefer-dark`.

## Dead ends — do not retry

- A light shell built from `*-Light-solid` gives white pills per panel button.
- Turning the panel blur off (a backgroundless bar, Tahoe's default) is unreadable on the user's busy wallpapers.
- Turning popup blur off leaves quick settings unreadably transparent; the user wants Blur my Shell kept on.
- Dynamic Blur my Shell blur on popups or the dock is never corner-clipped on GNOME 50.

## Pending

- Follow up on vicinaehq/vicinae#2112: a selected row's accessory text ("Application", "Command") stays `text.muted`, grey on the MacTahoe theme's blue selection. Once fixed upstream, nothing changes on our side: the theme already sets `list.item.selection.secondary_foreground`.
- Auto-switching light/dark across GTK3, shell and icons together is not implemented; only libadwaita follows `color-scheme`.
