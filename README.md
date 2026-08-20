# Gridgets — GNOME Shell Widgets

![Gridgets Showcase](assets/github/showcase.gif)

Gridgets is a GNOME Shell extension that places widgets directly on your desktop using a responsive grid layout. Add clocks, system monitors, weather forecasts, sticky notes, media controls, animated images, and custom command outputs, then move, resize, and style each widget independently to match your setup.

## User Guide

For a detailed walkthrough of all widgets, customization options, and desktop interactions, see the [User Guide](assets/github/user-guide/README.md).

## Features

- **Grid Alignment:** Snap widgets cleanly to a responsive desktop grid.
- **Built-in Widgets:** Time & Date, Weather, Pomodoro, Media Player, CPU/RAM, Network Speed, Image/GIF Slideshows, and Custom Bash Scripts.
- **Individual Styling:** Customize colors, fonts, border radii, and border widths for every widget.
- **Resource Efficient:** Uses a single background polling loop to keep CPU and battery usage minimal.

## Screenshots

| Grid Layout | Widget Preferences |
|-------------|--------------------|
| ![Desktop Grid](assets/github/desktop.png) | ![Preferences UI](assets/github/screenshot.png) |

## Installation

### Option A: From GitHub Releases (Easiest)

1. Download the latest release `.zip` file (`gridgets@rebatnaath.github.com.shell-extension.zip`) from the [Releases](https://github.com/rebatnaath/gridgets/releases) page.
2. Install it using the `gnome-extensions` CLI command:
   ```bash
   gnome-extensions install --force gridgets@rebatnaath.github.com.shell-extension.zip
   ```
   *(The `--force` flag automatically overwrites any existing installation.)*
3. Restart GNOME Shell:
   * **Wayland:** Log out and log back in.
   * **X11:** Press `Alt` + `F2`, type `r`, and press `Enter`.
4. Enable the extension:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

---

### Option B: Manual Directory Copy (From Source)

If you cloned or downloaded the raw repository source:

1. Remove any previous installation directory to prevent leftover file conflicts:
   ```bash
   rm -rf ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   ```
2. Copy the extension files into your GNOME extensions directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   cp -r . ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   ```
3. Restart GNOME Shell: log out and log back in (Wayland), or press `Alt` + `F2`, type `r`, and press `Enter` (X11).
4. Enable the extension:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

---

### Option C: Build and Install Zip Package

1. Package the extension inside the project directory:
   ```bash
   gnome-extensions pack \
   --extra-source=assets/close.svg \
   --extra-source=assets/resize.svg \
   --extra-source=assets/thumbnails \
   --extra-source=assets/weather \
   --extra-source=desktopGrid.js \
   --extra-source=prefs \
   --extra-source=schemas \
   --extra-source=utils \
   --extra-source=widgets \
   --extra-source=extension.js \
   --extra-source=prefs.js \
   --extra-source=metadata.json \
   --force
   ```
2. Install the zip file (automatically overwriting previous versions):
   ```bash
   gnome-extensions install --force gridgets@rebatnaath.github.com.shell-extension.zip
   ```
3. Restart GNOME Shell and enable:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.github.com
   ```

## Configuration

Open the **Extensions** (or Extension Manager) app and click the gear icon next to Gridgets to configure your grid settings and customize your widgets.

## Compatibility

Supported GNOME Shell versions: `45`, `46`, `47`, `48`, `49`, `50`.

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before opening an issue or pull request. It covers how to report issues and request features, plus the coding conventions, validation, and review process.

## License

Gridgets is free software, released under the [GNU General Public License v3.0](LICENSE).

## Acknowledgements

Thanks to these projects for providing assets used in this extension:

* [SVG Repo](https://www.svgrepo.com/) for vector icons.
* [Meteocons by basmilius](https://github.com/basmilius/meteocons) for the weather icons.


