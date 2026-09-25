# Changelog

All notable changes to Gridgets are recorded here.

## Unreleased

55 commits since `v0.9.5-beta`, touching 150 files.

### Breaking changes

Read these before upgrading. Some of them change stored settings or the size a
widget appears at.

- **The `weather-city` setting is gone.** Weather and solar schedule widgets now
  read their city from the locations saved in GNOME Weather. Anyone who had a
  city set in the old `weather-city` key has to pick it again from the GNOME
  Weather list when they next open the widget settings.
- **The grid geometry has changed.** The grid is now 60 columns wide, up from 50,
  and the row count is derived from your monitor height instead of a fixed 16.
  Widgets are stored as column and row coordinates against the old grid, so
  expect existing widgets to need repositioning after upgrading. Check your
  layout before adding anything new.
- **Preset widgets now spawn at Large** instead of Medium, so a newly added
  widget lands at the size its type's S/M/L table calls for.
- **The sun schedule widget has new default sizes**: 7x5 small, 7x6 medium, 8x7
  large, up from 4x4 / 5x5 / 6x6.
- **Six more widget types now enforce a minimum size** (system dashboard,
  pomodoro focus, todo, github, rss headlines, sun schedule). These can no longer
  be dragged smaller than their small preset.
- **`schemas/gschemas.compiled` is no longer committed.** It is a build artifact,
  and a fresh clone now contains only the `.gschema.xml`. Run
  `glib-compile-schemas` in the `schemas` directory after copying, or every
  setting silently falls back to its default.

### Weather

- Weather and solar schedule widgets take their city from locations saved in
  GNOME Weather rather than a bundled city list. The bundled
  `assets/datas/cities.json` and the custom weather SVGs have been deleted.
- Icons are now GNOME's symbolic weather icons instead of bundled artwork, and
  cloudy and overcast are distinguished rather than sharing one icon and
  background.
- Clicking a weather widget opens GNOME Weather at that widget's own saved city.
  It previously fell back to the app's default location.
- Preferences open normally when GNOME Weather is not installed. Only the city
  pickers are affected.
- Weather and solar schedule entries are disabled in the store when GNOME Weather
  is missing, with a tooltip naming the package to install.
- The solar schedule background stays transparent again.

### Theme and appearance

- Theme card and highlight surface colours are respected across every widget, and
  every built-in theme preset now defines its own pair. An unset value derives
  from the background instead of rendering undefined.
- New card and highlight colour pickers in the appearance page, plus first day of
  week and weekend day options for the calendar widget.
- Switching to Custom now starts from the last predefined theme you used instead
  of resetting to a hardcoded dark palette.
- The accent colour follows the system accent rather than a fixed blue.
- Font weights and text opacity are standardised through shared typography
  tokens.
- Widget scale is clamped, so text no longer grows without limit on oversized
  widgets.
- Corner rounding is standardised to the GNOME 15px standard, and the grid gap
  is 15px as well.

### Widget behaviour

- Calendar shows events as dots and gained arrow buttons for moving between
  months. Clicking it opens GNOME Calendar.
- Clicking the time or world clock widget opens GNOME Clock. World clock cities
  are read from GNOME Shell over D-Bus, so you configure them in GNOME Clocks
  rather than in Gridgets.
- The mood widget no longer rewrites its data file every time it is opened.
- Screen time is now counted when no app is focused, which previously left gaps in
  the data synced to digital wellbeing. Clicking the screen time widget opens the
  digital wellbeing page in Settings.
- The notes editor is no longer rebuilt on every resize, which had been dropping
  keyboard focus mid typing.
- The github activity widget has a reworked layout, and the rss headlines widget
  picked up some small UI tweaks.
- System dashboard cards now scale their padding, rounding and spacing on resize
  instead of keeping their values from creation time.
- Media captions gained a "use global setting" switch, and the loading
  placeholder now scales with the widget.

### Fixes

- The music artwork no longer disappears if settings are changed while something
  is playing.
- The elapsed time labels no longer lose their dimming as soon as the widget is
  resized.
- The music progress bar track is visible against the widget background again.
- The small music player is readable on light themes, which dark text over a
  fixed dark scrim had made impossible.
- The responsive scaler no longer feeds non-finite or zero sizes into layout
  callbacks, which could produce NaN geometry during teardown.
- Pending media loads are cancelled when a widget is destroyed, and failures are
  no longer logged for widgets that are already gone.
- In-flight system metric reads are cancelled when polling stops.
- Parsed RSS items are cached per feed, so a widget rebuilt mid interval no longer
  flashes empty.
- The clipboard widget resolves its card and highlight colours once instead of
  twice.
- A syntax error that stopped the extension loading has been fixed.

### Internals

- Widgets are organised into categorised subdirectories under `widgets/`.
- Shared helpers were extracted rather than duplicated: typography tokens, click
  versus drag detection, spark tile rows, and one style helper for the pomodoro
  controls.
- The CPU, RAM and network widgets share a single spark tile row implementation
  in place of three near-identical copies.
- The grid computes its geometry in the constructor instead of falling back to a
  stale constant, and rebuilds on the new global settings keys.
- The compiled settings schema is no longer tracked; see Breaking changes.
- The `rss-feed` widget type was removed. It was only ever an internal label and
  was never a value that could be stored, so no widget is affected.
- Unused generators for fake mood and fake screen time data were removed.
- Destroyed-actor detection relies solely on the tracked set, since Clutter
  exposes no destruction flag on GNOME Shell 45 to 50.
- Roughly 20 dead exports and several unused settings reads were dropped.

### Documentation

- The README gained Widget Requirements and Known Limitations sections, a NixOS
  section covering the required packages and schema paths, and a note about
  browsers registering themselves as MPRIS players.
- The design docs had stale grid width, opacity token names and exceptions
  corrected.
- Issue templates for bug reports and feature requests were added.
- The stale CPU and memory redesign document was deleted.
- Acknowledgements no longer credit icon sources that are no longer bundled.
