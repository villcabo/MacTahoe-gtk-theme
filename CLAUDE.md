# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A personal fork of [vinceliuice/MacTahoe-gtk-theme](https://github.com/vinceliuice/MacTahoe-gtk-theme) whose goal is to make Ubuntu 26.04 / GNOME Shell 50 (Wayland) look like **macOS 26 Tahoe**, in both light and dark.

- Fork: `villcabo/MacTahoe-gtk-theme`, branch **`tahoe`** (default branch). One branch holds both variants: the SCSS compiles light and dark from the same sources, so never split work into per-variant branches.
- Remotes: `origin` = the fork, `upstream` = vinceliuice. Sync with `git fetch upstream && git rebase upstream/main` (a force-push follows).
- Sibling forks used by the same setup:
  - `villcabo/blur-my-shell`, branch `feat/dock-radius-from-theme`: the static dock blur takes its corner radius from the theme's `.dash-background`.
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
- **Dock** (`src/sass/_colors.scss` `$dash_bg` / `$dash_highlight`): the dock carries its own frost (light) or smoke (dark), so it reads as glass with or without Blur my Shell.
- **Quick settings** (`widgets-48-0/_quick-settings.scss`):
  - A light-glass palette: dark text, translucent white modules, accent-filled checked toggles. Upstream's transparent palette assumed dark glass.
  - Compact slider rows.
- **Shared radius:** `$control_center_radius` (33 px) in `_variables.scss` is used by both quick settings and the calendar, because Blur my Shell clips both with a single radius.

## Environment gotchas (this machine)

- **`gsettings` on PATH is Homebrew's.** It silently writes to `~/.config/glib-2.0/settings/keyfile`, which GNOME never reads. Use `/usr/bin/gsettings` or `dconf`, and verify every change with `dconf read`.
- **Symbolic icons must be fill-only.** Symbolic rendering forces `fill`, so a `stroke` outline renders as a solid blob. Draw outlines as evenodd outer and inner shapes.
- **St caches icon textures by path.** A changed SVG at the same path shows the old image until re-login; test it under a new filename.
- **Never call the StatusNotifierWatcher synchronously** from inside gnome-shell. It lives in the shell (appindicators), so the call blocks the shell until the D-Bus timeout. Use async calls only.
- **kitty runs on X11:** its titlebar comes from `mutter-x11-frames` and only re-themes after re-login.
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
  - Dock: blur on, **static**, using the "Rounded" pipeline with blur brightness 0.9. With 0.6 plus the theme's smoke, the dark dock went near-black.
  - The pipeline's corner radius (26) is ignored now: the patched Blur my Shell takes it from `.dash-background` (28). This was verified after a re-login on 2026-10-07: clean corners.
  - Dynamic dock blur can never be rounded, because it uses a `DummyPipeline` with no corner effect.
- **Ubuntu Dock:**
  - `custom-background-color=false` and `transparency-mode=DEFAULT`, because its inline style overrode the theme.
  - `custom-theme-customize-running-dots=false`, because its dark dots were invisible on the dark dock.
- `light-style` extension disabled.
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

- Auto-switching light/dark across GTK3, shell and icons together is not implemented; only libadwaita follows `color-scheme`.
- Optional: propose the Blur my Shell dock fix upstream as a PR.
