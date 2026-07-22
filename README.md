# Gridgets

![Gridgets Showcase](assets/github/showcase.gif)

Gridgets is a grid-based desktop widget extension for GNOME Shell.

It lets you place widgets directly onto your desktop using a clean grid system. You can add things like digital clocks, system monitors, weather forecasts, sticky notes, media controls, animated GIFs, and even custom bash command outputs. Each widget can be independently moved, resized, and styled to match your setup.

## 🌟 Features

- **Grid Alignment:** Snap widgets cleanly to a responsive desktop grid.
- **Built-in Widgets:** Time & Date, Weather, Pomodoro, Media Player, CPU/RAM, Network Speed, Image/GIF Slideshows, and Custom Bash Scripts.
- **Individual Styling:** Customize colors, fonts, border radii, and border widths for every widget.
- **Resource Efficient:** Uses a single background polling loop to keep CPU and battery usage minimal.

## 📸 Screenshots

| Grid Layout | Widget Preferences |
|-------------|--------------------|
| ![Desktop Grid](assets/github/desktop.png) | ![Preferences UI](assets/github/screenshot.png) |

## 🚀 Installation

### 1. From extensions.gnome.org (Recommended)
*Coming soon! Once it finishes the official GNOME review process, you will be able to install it directly from the Extensions website.*

### 2. Manual Installation

If you want to test it early or build from source:

**Option A: Direct Copy (Quickest)**

1. Clone or download this repository.
2. Copy the extension folder to your local GNOME directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   cp -r gridgets ~/.local/share/gnome-shell/extensions/gridgets@rebatnaath.github.com
   ```

3. Restart GNOME Shell:
* **X11:** Press `Alt` + `F2`, type `r`, and hit `Enter`.
* **Wayland:** Log out and log back in.


4. Enable the extension:
```bash
gnome-extensions enable gridgets@rebatnaath.github.com

```



**Option B: Build and Install via Zip**

1. Inside the project folder, package the extension into a zip:
```bash
gnome-extensions pack --extra-source=assets/ --extra-source=desktopGrid.js --extra-source=gridgetClipboard.js --extra-source=gridgetCommand.js --extra-source=gridgetCpuRam.js --extra-source=gridgetGif.js --extra-source=gridgetImage.js --extra-source=gridgetMusic.js --extra-source=gridgetNetworkSpeed.js --extra-source=gridgetNotes.js --extra-source=gridgetPomodoro.js --extra-source=gridgetSlideshow.js --extra-source=gridgetTime.js --extra-source=gridgetWeather.js --extra-source=prefsHelpers.js --extra-source=systemMonitorEngine.js --extra-source=widgetEditUtils.js --extra-source=widgetUIUtils.js --extra-source=widgetUtils.js

```


2. Install the zip file:
```bash
gnome-extensions install gridgets.zip

```


3. Restart GNOME Shell (Log out/in on Wayland, or `Alt+F2` -> `r` on X11) and enable it.

## ⚙️ Configuration

Open the **Extensions** (or Extension Manager) app and click the gear icon next to Gridgets to configure your grid settings and customize your widgets.

## ✅ Compatibility

Supported GNOME Shell versions: `45`, `46`, `47`, `48`, `49`, `50`.

## 🙏 Acknowledgements

Thanks to these projects for providing assets used in this extension:

* [SVG Repo](https://www.svgrepo.com/) for vector icons.
* [Meteocons by basmilius](https://github.com/basmilius/meteocons) for the weather icons.


