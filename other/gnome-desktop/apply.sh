#!/usr/bin/env bash
# Installs the GNOME Shell extensions listed in extensions.tsv and loads their
# settings from dconf/, reproducing the MacTahoe Glass desktop.
# Usage: ./apply.sh [--dry-run]

set -euo pipefail

readonly DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly EXT_PATH="/org/gnome/shell/extensions"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

run() {
  echo "+ $*"
  "${DRY_RUN}" || "$@"
}

installed() {
  gnome-extensions info "$1" &>/dev/null
}

# Asks the running shell to install from extensions.gnome.org; GNOME shows a
# confirmation dialog. The org.gnome.Shell.Extensions destination is the
# Extensions app and does not install anything.
install_remote() {
  run gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.InstallRemoteExtension "$1"
}

# settings file -> dconf directory it belongs to
declare -A SETTINGS_PATH=(
  [user-theme.ini]="${EXT_PATH}/user-theme/"
  [blur-my-shell.ini]="${EXT_PATH}/blur-my-shell/"
  [dash-to-dock.ini]="${EXT_PATH}/dash-to-dock/"
  [appindicator.ini]="${EXT_PATH}/appindicator/"
  [rounded-window-corners.ini]="${EXT_PATH}/rounded-window-corners-reborn/"
  [interface.ini]="/org/gnome/desktop/interface/"
  [wm-preferences.ini]="/org/gnome/desktop/wm/preferences/"
)

if ! pgrep -x gnome-shell >/dev/null; then
  echo "GNOME Shell is not running; log in to a GNOME session first." >&2
  exit 1
fi

while IFS=$'\t' read -r uuid ego_id _required settings _role; do
  [[ "${uuid}" == \#* || "${uuid}" == "uuid" || -z "${uuid}" ]] && continue

  if ! installed "${uuid}"; then
    case "${ego_id}" in
      bundled) echo "! ${uuid} is missing: run ../../install.sh first" ;;
      ubuntu)  echo "! ${uuid} ships with Ubuntu; elsewhere install the alternative named in extensions.tsv" ;;
      *)       install_remote "${uuid}" ;;
    esac
  fi
  installed "${uuid}" && run gnome-extensions enable "${uuid}"

  if [[ "${settings}" != "-" ]]; then
    run dconf load "${SETTINGS_PATH[${settings}]}" < "${DIR}/dconf/${settings}"
  fi
done < "${DIR}/extensions.tsv"

for settings in interface.ini wm-preferences.ini; do
  run dconf load "${SETTINGS_PATH[${settings}]}" < "${DIR}/dconf/${settings}"
done

echo "Done. Log out and back in if an extension was installed or updated."
