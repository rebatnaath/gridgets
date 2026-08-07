# Gridgets User Guide

> **Last updated:** Aug 7, 2026 · **Version:** v0.9.4-beta

Everything you need to go from adding your first widget to fine-tuning each one to match your setup.

---

[➕ Adding Widgets](#-adding-widgets) · [💬 Additional Dialog](#-widgets-with-additional-dialog) · [🖱️ Desktop Interaction](#-desktop-interaction) · [🎨 Appearance](#-appereance) · [🌐 Global Settings](#-global-settings) · [🎛️ Individual Settings](#-individual-settings) · [🧩 Widget Overview](#-widget-overview)

---

## ➕ Adding Widgets

You can add widgets by clicking the **Add to Desktop** button in the settings of the extension.

- Most widgets should spawn straight onto your desktop.
- Widgets that require more information will ask you for that in a dialog first.

<img src="assets/adding-widgets.gif" alt="Adding Widgets Demo" width="100%">

---

## 💬 Widgets With Additional Dialog

Widgets that need extra configuration, such as **Image / GIF**, **Slideshow**, **World Clock**, and **Command Launcher**, will open a setup dialog before they are placed so you can provide the required details.

<img src="assets/widgets-with-additional-dialog.gif" alt="Widgets With Additional Dialog Demo" width="100%">

### 🖱️ Desktop Interaction

To **resize**, **delete**, or open the individual settings of a widget, **right-click** on the widget on the desktop.

- **Configure Widget…**: opens the individual settings page of the widget. It's currently not working; it will be fixed in the next update.
- **Resize Widget**: a resize toggle appears. Dragging it resizes the widget.
- **Delete Widget**: removes the widget.
- You can also **drag** widgets anywhere on the desktop to place or rearrange them.

<img src="assets/desktop-interaction.gif" alt="Desktop Interaction Demo" width="100%">

---

## 🎨 Appereance

We have various settings in **Appearance**, such as **themes**, **corner rounding**, **border width** and others.

Keep in mind that changing the background colour (or basically anything) here will be applied across **all** placed widgets. If you want to control specific or individual widgets, you can use the [Individual Settings](#-individual-settings).

<img src="assets/appereance-settings.gif" alt="Appearance Demo" width="100%">

---

## 🌐 Global Settings

Global settings include some default settings for certain types of widgets, such as **Images** and **Weather**.

<img src="assets/global-settings.gif" alt="Global Settings Demo" width="100%">

### 🌤️ Global Settings: Weather

- **Dynamic weather colour**: applies a background colour to the weather widget based on the current time and condition in that city.
- **Overlay image**: adds an overlay image based on the city.

If you're not a fan of these, you can disable them, as shown in the video.

<img src="assets/global-settings-weather.gif" alt="Global Settings Weather Demo" width="100%">

---

## 🎛️ Individual Settings

Individual Settings is very powerful. Every widget has its own control, so some widgets can look totally different even if they are the same. Please tinker with them yourself and see how you can customise them :P

<img src="assets/individual-settings.gif" alt="Individual Settings Demo" width="100%">

---

## 🧩 Widget Overview

Gridgets offers **16+ desktop widgets** plus **panel indicators** across five categories. Each widget lives on your desktop grid and can be moved, resized, and styled independently.

### Weather Widgets

Three layouts powered by the [Open-Meteo](https://open-meteo.com/) free API (no API key required). The city is configured when adding the widget. Data refreshes every 30 minutes.

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **Weather Standard** | <img src="../../thumbnails/weathers/weather-standard.svg" width="50%"> | Current conditions, temperature, condition icon, high/low. Dynamic backgrounds change with weather/day-night. |
| **Weather Minimal** | <img src="../../thumbnails/weathers/weather-minimal.svg" width="50%"> | Compact view with large temperature and city name. Ideal for a clean look. |
| **Weather Forecast** | <img src="../../thumbnails/weathers/weather-forecast.svg" width="50%"> | Extended layout with 6-hour hourly forecast alongside current conditions. Dynamic backgrounds supported. |

> ⚠️ **Weather widgets** (other than Weather Minimal) are not currently resizable; this is being worked on.

### Music & Audio Widgets

Displays media playback from your system's MPRIS-compatible players (Spotify, Rhythmbox, etc.).

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **Music Player** | <img src="../../thumbnails/music/music-small.svg" width="50%"> | Square layout with album art and playback controls. |
| **Music Player (Wide)** | <img src="../../thumbnails/music/music-large.svg" width="50%"> | Wide 2-panel layout with album art, track/artist/album info, and playback controls. |

### Time & Clock Widgets

Powered by GLib.DateTime (system clock). No external API needed.

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **Time & Date** | <img src="../../thumbnails/date-and-time/date-and-time.svg" width="50%"> | Digital clock with current date. Supports 12h/24h format. Updates every minute, aligned to the minute boundary. |
| **World Clock** | <img src="../../thumbnails/date-and-time/world-clock.svg" width="50%"> | Multi-city clock showing up to three timezones (primary large + two secondary). Supports 12h/24h format. |
| **Calendar** | <img src="../../thumbnails/calendar/calendar.svg" width="50%"> | A monthly calendar with today highlighted and month navigation. |

### Media & Photos Widgets

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **Image / GIF** | <img src="../../thumbnails/images/image-and-slideshow.svg" width="50%"> | Display a static image or animated GIF from your filesystem. |
| **Image Slideshow** | <img src="../../thumbnails/images/image-and-slideshow.svg" width="50%"> | Cycle through all images in a folder with crossfade transitions. Configurable interval (5–3600s). |

### System & Utilities Widgets

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **System Dashboard** | <img src="../../thumbnails/system-utils/system-dashboard.svg" width="50%"> | All-in-one panel: CPU frequency, temperature, utilization, task count, upload/download speeds, and RAM usage bar. |
| **Pomodoro Timer** | <img src="../../thumbnails/pomodoro/pomodoro.svg" width="50%"> | Focus timer with work (25min), short break (5min), and long break (15min) cycles. Circular progress arc, session counter. *State is in-memory, so it resets on reload.* |
| **System Monitor** | <img src="../../thumbnails/system-utils/system-monitor.svg" width="50%"> | CPU utilization and RAM usage displayed as circular arc gauges. |
| **Network Speed** | <img src="../../thumbnails/system-utils/network-speed.svg" width="50%"> | Live upload/download speed tracker reading `/proc/net/dev`. |
| **Quick Notes** | <img src="../../thumbnails/quick-notes/quick-notes.svg" width="50%"> | Markdown sticky note with bold, italic, headers, and checkbox support. Content auto-saved to a JSON file. |
| **Clipboard History** | <img src="../../thumbnails/clipboard/clipboard.svg" width="50%"> | Remembers your last 10 clipboard entries. Click any item to recopy it. |
| **Command Launcher** | <img src="../../thumbnails/commands/commands.svg" width="50%"> | Desktop shortcut to run any bash command or script. Click to execute in a terminal. Custom icon or image. |
| **App Launcher** | <img src="../../thumbnails/apps/app-launcher.svg" width="50%"> | Launch up to 8 installed applications from a compact desktop widget. |
| **Quotes** | <img src="../../thumbnails/quotes/quotes.svg" width="50%"> | Daily quotes from philosophers, programmers, and thinkers. |

### Panel Indicators

| Widget | Thumbnail | Description |
|--------|-----------|-------------|
| **Screen Time** | <img src="../../thumbnails/panel/screen-time.svg" width="50%"> | Tracks how long each app has been in focus today. Shows a ranked list with usage bars in the panel. |
| **Store Panel Button** | <img src="../../thumbnails/panel/panel-store.svg" width="50%"> | Quick-add widgets from a panel popup. (Image, Slideshow, Command, and World Clock are omitted; use the full Store page for those.) |