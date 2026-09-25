# Changelog

All notable changes to Gridgets are recorded here.

## Unreleased

Since `v0.9.5-beta`.

### Breaking changes

Read these before upgrading. Some of them change saved settings or the size a
widget appears at.

- **The `weather-city` setting is gone.** Weather and solar schedule widgets now
  take their city from the places saved in GNOME Weather. If you had a city set
  in the old `weather-city` setting, pick it again from the GNOME Weather list
  next time you open the widget settings.
- **The grid is a different size.** It is now 60 columns wide instead of 50, and
  the number of rows now comes from your monitor height instead of always being
  16. Widgets save their position as a column and row number, so the ones you
  already have will need moving. Check your layout before adding new widgets.
- **New widgets now open at Large** instead of Medium, so they start at the size
  their small, medium or large option calls for.
- **The sun schedule widget now starts bigger:** 7x5 small, 7x6 medium, 8x7 large.
  It used to be 4x4, 5x5 and 6x6.
- **Six widget types now have a smallest size** (system dashboard, pomodoro focus,
  todo, github, rss headlines, sun schedule). You can no longer drag them smaller
  than their small option.

### Weather

- Weather and solar schedule widgets take their city from the places saved in
  GNOME Weather, instead of a city list that shipped with the extension. That
  list and the custom weather drawings have both been deleted.
- Weather icons are now GNOME's own outline icons. Cloudy and overcast now look
  different instead of sharing one icon and one background.
- Clicking a weather widget opens GNOME Weather at that widget's own city.
- Weather and solar schedule are greyed out in the store when GNOME Weather is not
  installed, with a note saying what to install.

### Theme and colours

- Card and highlight colours now work across every widget, and each built-in
  theme has its own pair. If you leave one unset it is worked out from the
  background colour.
- Added card and highlight colour pickers, plus settings for which day the
  calendar week starts on and which days count as the weekend.
- Choosing the Custom theme now starts from the last built-in theme you used,
  instead of going back to a fixed dark set of colours.
- The accent colour now follows your system accent colour instead of a fixed
  blue.
- Text sizes, weights and fading are now set in one shared place, so widgets
  match each other.
- Widget scaling is capped, so text no longer grows forever on a very large
  widget.
- Widget corners are now 15px to match GNOME, and the gap between grid cells is
  15px too.

### Widgets

- The calendar shows events as dots and has arrow buttons to move between months.
  Clicking it opens GNOME Calendar.
- Clicking the time or world clock widget opens GNOME Clock. World clock cities
  now come from GNOME Shell, so you add them in GNOME Clocks rather than in
  Gridgets.
- Screen time is now counted when no app is focused. Before, those gaps never
  reached your digital wellbeing total. Clicking the screen time widget opens
  that page in Settings.
- The notes editor is no longer rebuilt on every resize, which used to lose
  keyboard focus while you were typing.
- The github activity widget has a new layout, and the rss headlines widget had
  some small tidy ups.
- System dashboard cards now scale their padding, corners and spacing when you
  resize them, instead of staying as they were when created.
- Media captions got a "use the global setting" switch, and the loading text now
  scales with the widget.

### Fixes

- Music artwork no longer vanishes if you change settings while something plays.
- The elapsed time labels no longer go back to full brightness after a resize.
- The music progress bar line is visible against the background again.
- The small music player can be read on light themes, which dark text on a dark
  overlay had made impossible.
- Widgets no longer try to resize themselves using broken sizes during startup or
  teardown, which could produce a widget with no size at all.
- Pictures stop loading if their widget is deleted, and no longer log an error
  for a widget that is already gone.
- System readings stop being fetched when nothing is watching them.
- RSS headlines now keep their items when a widget is rebuilt, instead of
  briefly showing nothing.
- The clipboard widget now works out its card and highlight colours once instead
  of twice.

Two known problems from `v0.9.4-beta` are fixed here: some widgets scaled their
text wrongly, and music artwork could disappear.

### Internals

- Shared helpers were pulled out instead of being copied around: text size and
  weight settings, telling a click apart from a drag, the small graphs used by the
  system widgets, and the button styling on the pomodoro timer.
- The CPU, RAM and network widgets now share one implementation of their graph
  row instead of having three almost identical copies.
- The grid now works out its own size when it starts, instead of falling back to
  an old fixed number, and it redraws when the new colour settings change.
- Removed the fake mood and fake screen time data generators.
- Removed unused code and a few settings that were read but never used.

### Documentation

- The README now has a Widget Requirements section, a Known Limitations section,
  a NixOS section covering which packages to install, and a note about browsers
  taking over as the music player.
- Added issue templates for bug reports and feature requests.
- Updated the acknowledgements.

## v0.9.5-beta

### New widgets

- **Tasks** - a todo list with a counter for how many are pending, boxes to tick
  items off, and a box to add one quickly.
- **Month Calendar** - a small month grid with today marked and the weekend in a
  different colour.
- **GitHub Activity** - your GitHub contribution graph with your avatar, a total
  for the year, and a note showing when it last synced.
- **RSS Headlines** - a card that rotates through article headlines from any
  feed.
- **Mood Logger** - record how you feel each day and watch the last four weeks
  fill in with colour.
- **Solar Schedule** - sunrise and sunset times for any city.
- **Pomodoro Focus** - a small focus timer with a mode switch, a round progress
  dial and a count of sessions done.
- **Screen Time** - see how long you have been at the desktop.

### Improvements

- Widgets now scale their text, icons and padding properly when you resize them.
- Weather widgets can show a background that changes with the conditions and
  the time of day.
- The quotes widget now reads from a hosted file rather than a bundled copy.
- The music widget was split into separate parts for artwork, controls, cover and
  playback state.
- The insights page in preferences now works on GNOME 46.
- Screen time tracking starts as soon as the extension loads.

### Fixes

- The grid now clears away its context menu properly when it closes.
- Fixed crashes in preferences and in widgets.
- Removed the test data that the mood logger and screen time engine used to
  insert.
- Fixed the music artwork disappearing, and added a background to the small
  layout.

### Removed

- **Command Launcher** is gone. Use App Launcher instead.

## v0.9.4-beta

First release.

### Included

- Weather widgets with standard, minimal and forecast layouts.
- A music player with a small and a wide layout.
- A digital clock, a world clock and a month calendar.
- Image and animated GIF widgets, plus a slideshow that fades between pictures in
  a folder.
- A system dashboard with CPU, temperature, tasks, network and RAM, a CPU and RAM
  monitor, and a network speed tracker.
- A pomodoro timer, sticky notes, clipboard history, an app launcher for up to
  8 apps, and a quotes widget.
- A screen time tracker and a panel button for quick access to the store.
- Per widget control of colours, fonts, corner rounding and border width.
- Theme presets, and settings for the grid, fonts, weather city and monitors.

### Known issues

- The picture behind weather widgets always had rounded corners and there was no
  way to change that.
- Album art sometimes failed to show, depending on the player or playback state.
- A custom corner radius on the calendar only applied to the bottom corners.
- Some widgets did not scale their text to match the global font size.
