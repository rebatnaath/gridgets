# Gridgets - GNOME Shell Widgets

![Gridgets Showcase](github/showcase.png)

| | | |
|---|---|---|
| ![Showcase 1](github/showcase1.png) | ![Showcase 2](github/showcase2.png) | ![Showcase 3](github/showcase3.png) |

Gridgets is a GNOME Shell extension that places widgets directly on your desktop using a responsive grid layout. Add clocks, system monitors, weather forecasts, sticky notes, media controls, animated images, and more, then move, resize, and style each widget independently to match your setup.

<!-- ## User Guide

For a detailed walkthrough of all widgets, customization options, and desktop interactions, see the [User Guide](github/user-guide/README.md). -->

## Features

- **Grid Alignment:** Snap widgets cleanly to a responsive 60-column desktop grid.
- **24+ Built-in Widgets:** Weather, Time, Calendar, Music, System Monitor, Notes, Clipboard, Pomodoro, Tasks, GitHub, RSS, Mood, Images, and more.
- **Individual Styling:** Customize colors, fonts, border radii, and sizes for every widget.
- **Size Presets:** Quick S/M/L sizing from the right-click context menu.
- **Drag & Resize:** Move widgets by dragging, resize with the corner handle.
- **Multi-Monitor:** Show widgets on primary, all, or each monitor independently.
- **Follow System Theme:** Automatically switch between light and dark mode.

## Widget Requirements

Most widgets need nothing beyond GNOME Shell. A few read data from other
applications:

| Widget | Needs | If missing |
| --- | --- | --- |
| Weather, Solar Schedule | GNOME Weather | cannot be added |
| World Clock | GNOME Clocks | can be added; picker reports if unreachable |
| Calendar grid (event dots) | Evolution Data Server | adds fine, no events shown |

A widget that cannot be added is disabled in the store with a tooltip saying
what to install. Install the listed applications for those widgets to work
correctly.

## Known Limitations

- **Music and browsers:** a browser registers itself as an MPRIS player and
  publishes `MetadataChanged` for whatever it considers active. Most browsers do
  not implement `Next` and `Previous`, so the skip buttons do nothing while the
  browser is the active player. Hovering a video thumbnail also makes the
  browser publish that preview's metadata, which can replace the currently
  playing track in the widget until real playback metadata arrives again.
  Gridgets ranks a player reporting `Playing` above one that only has metadata,
  but a hovered preview can still win briefly.
- **Flatpak-only GNOME Weather is not detected**, since Gridgets looks for the
  executable on `PATH`.

## Installation


### Option A: From GitHub Releases

1. Download the latest `.zip` file from the [Releases](https://github.com/rebatnaath/gridgets/releases) page.
2. Install it:
   ```bash
   gnome-extensions install --force gridgets@rebatnaath.github.com.shell-extension.zip
   ```
3. Restart GNOME Shell:
   * **Wayland:** Log out and log back in.
   * **X11:** Press `Alt` + `F2`, type `r`, and press `Enter`.
4. Enable the extension:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

---

### Option B: Manual Directory Copy (From Source)

1. Remove any previous installation:
   ```bash
   rm -rf ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   ```
2. Copy the extension files:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   cp -r . ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   ```
3. Compile the settings schema. `gschemas.compiled` is a build artifact and is
   not committed, so a fresh clone has only the `.gschema.xml`. Without this
   step the extension loads but every setting silently falls back to its default:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com/schemas
   ```
4. Restart GNOME Shell (log out/in on Wayland, or `Alt+F2` → `r` on X11).
5. Enable:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

---

### Option C: Build Zip Package

1. From the project directory:
   ```bash
   gnome-extensions pack \
     --extra-source=assets \
     --extra-source=desktopGrid \
     --extra-source=shell \
     --extra-source=schemas \
     --extra-source=utils \
     --extra-source=widgets \
     --extra-source=prefs \
     --force
   ```
2. Install:
   ```bash
   gnome-extensions install --force gridgets@rebatnaath.github.com.shell-extension.zip
   ```
3. Restart and enable:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

### NixOS: Installing the Requirements

For the applications listed under Widget Requirements, install the packages and
expose their GSettings schemas:

```nix
{
    home.packages = with pkgs; [
        gnome-weather
        gnome-clocks
    ];

    environment.systemPackages = with pkgs; [
        gnome-calendar
    ];

    services.gnome.evolution-data-server.enable = true;

    environment.sessionVariables.GSETTINGS_SCHEMA_DIR = [
        "${pkgs.gnome-weather}/share/gsettings-schemas/gnome-weather-${pkgs.gnome-weather.version}/glib-2.0/schemas"
    ];
}
```

The variable is needed because neither Home Manager's `home.packages` nor NixOS
puts package schemas on `XDG_DATA_DIRS`. If you configure NixOS itself, you can
drop it and use
`services.xserver.desktopManager.gnome.extraGSettingsOverridePackages` instead.

`gnome-weather` also supplies the `GWeather` typelib that Gridgets imports. World
clock cities are not read from a schema at all: Gridgets asks GNOME Shell for
them over D-Bus, and GNOME Shell resolves the `gnome-clocks` schema itself, so
only the weather schema needs exporting.

Rebuild, log out and back in, then check:

```bash
command -v gnome-weather
command -v gnome-clocks
gsettings list-schemas | grep org.gnome.Weather
```

That should list `org.gnome.Weather`.

## Configuration

Open the **Extensions** app (or Extension Manager) and click the gear icon next to Gridgets to configure your grid settings and customize your widgets.

## Compatibility

Supported GNOME Shell versions: `45`, `46`, `47`, `48`, `49`, `50`.

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before opening an issue or pull request.

## License

Gridgets is free software, released under the [GNU General Public License v3.0](LICENSE).

## Acknowledgements

Thanks to everyone who has contributed to Gridgets through code, bug reports and
suggestions.
