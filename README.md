# Gridgets

A grid-based desktop widget extension for GNOME Shell.

Gridgets brings customizable, interactive widgets directly to your desktop. You can place images, animated GIFs, weather forecasts, digital clocks, system monitors, sticky notes, media players, and more onto a configurable grid. Each widget can be independently dragged, resized, and stylized to create your perfect desktop experience.

## Features

- **Dynamic Grid Layout:** Snap widgets to a responsive desktop grid.
- **Vast Widget Library:** Includes Time & Date, Weather, Pomodoro, Music, CPU/RAM, Network Speed, Slideshows, and Custom Bash Commands.
- **Deep Customization:** Adjust background colors, text colors, fonts, border radii, and custom border widths for every individual widget.
- **High Performance:** Utilizes a centralized background polling engine to minimize system resource usage and maximize battery life.

## Manual Installation (For Beta Testing)

If you are testing this extension, you can easily install it manually without going through the official GNOME Extensions website.

### Option 1: Direct Copy (Easiest)

1. Download or clone this repository to your local machine.
2. Copy the entire folder into your GNOME Shell extensions directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   cp -r gridgets ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.local
   ```
3. Restart GNOME Shell:
   - **X11:** Press `Alt` + `F2`, type `r`, and hit `Enter`.
   - **Wayland:** Log out and log back in.
4. Enable the extension using the **Extensions** app or via the terminal:
   ```bash
   gnome-extensions enable gridgets@rebatnaath.local
   ```

### Option 2: Build and Install via Zip

1. Inside the project folder, pack the extension into a zip file:
   ```bash
   gnome-extensions pack --extra-source=assets/ --extra-source=documents/ --extra-source=pictures/ --extra-source=weathers/ --extra-source=quicknotes/ --extra-source=commands/ --extra-source=clipboard/ --extra-source=cpuAndRam/ --extra-source=dateAndTime/ --extra-source=musicPlayer/ --extra-source=networkSpeed/ --extra-source=pomodoro/
   ```
   *(Note: Adjust the `--extra-source` flags based on the exact directories present in the project).*
2. Install the zip file:
   ```bash
   gnome-extensions install gridgets.zip
   ```
3. Restart GNOME Shell (Log out/in on Wayland, or `Alt+F2` -> `r` on X11) and enable it.

## Configuration

Once installed, you can configure the grid and customize individual widgets by opening the **Extensions** app and clicking the settings (gear) icon next to Gridgets.

## Compatibility

Supported GNOME Shell versions: `45`, `46`, `47`, `48`, `49`, `50`.
