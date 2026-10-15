# Changelog

All notable changes to Gridgets are recorded here.

## Unreleased

Since `v0.9.5-beta`.

### Breaking changes

Read these before upgrading. Some of them change saved settings, or the size a widget
appears at.

- **The `weather-city` setting is gone.** Weather and solar schedule widgets now take
  their city from the places saved in GNOME Weather. If you had a city in the old
  setting, pick it again from the GNOME Weather list when you next open the widget
  settings.
- **The grid is a different size.** 60 columns wide instead of 50, and the number of
  rows comes from your monitor height instead of always being 16. Widgets save their
  position as a column and row number, so the ones you already have will need moving.
  Check your layout before adding new widgets.
- **New widgets now open at Large** instead of Medium, so they start at the size their
  small, medium or large option calls for.
- **The sun schedule widget now starts bigger:** 7x5 small, 7x6 medium, 8x7 large. It
  used to be 4x4, 5x5 and 6x6.

- **The time widget is now square** at 4x4, 5x5 and 6x6. One you already have keeps
  the size it was until you pick small, medium or large again.
- **The world clock is a flat list of cities.** It was one large city above two
  smaller ones. Now there is one row per city, the same size as the rest, with the
  city name on the left and the time on the right. The rows share whatever height the
  cell has, so a two-city clock fills the face instead of sitting at the top of it.
  There is no primary city any more, and the GMT offset that used to sit under each
  name is gone: the line under the name now says how far ahead of or behind you that
  city is.
  The sizes changed with it, and no longer depend on how many cities you have:
  6x4 small, 7x5 medium, 8x6 large. A two-city clock used to stop at small and list
  no other tiers. It offers all three now, and the extra height goes into the rows.
  A world clock you already have keeps its cities and its saved size until you pick
  again.

### Weather

- Weather conditions read as "Clear" instead of "Sunny" after dark, and the night
  hours get night icons. Before, a clear night showed a sun.
- A weather reading that fails to refresh falls back to the last good one and says how
  old it is, instead of going blank.
- Weather and solar schedule widgets take their city from the places saved in GNOME
  Weather, instead of a city list that shipped with the extension. That list and the
  custom weather drawings have both been deleted.
- Weather icons are GNOME's own outline icons. Cloudy and overcast now look different
  instead of sharing one icon and one background.
- Clicking a weather widget opens GNOME Weather at that widget's own city.
- Weather and solar schedule are greyed out in the store when GNOME Weather is not
  installed, with a note saying what to install.

### Theme and colours

- Card and highlight colours now work across every widget, and each built-in theme
  has its own pair. Leave one unset and it is worked out from the background colour.
- Added card and highlight colour pickers, plus settings for which day the calendar
  week starts on and which days count as the weekend.
- Choosing the Custom theme now starts from the last built-in theme you used, rather
  than a fixed dark set of colours.
- The accent colour follows your system accent colour instead of a fixed blue.
- Text sizes, weights and fading are set in one shared place, so widgets match each
  other.
- Widget scaling is capped, so text no longer grows forever on a very large widget.
- Widget corners are 15px to match GNOME, and the gap between grid cells is 15px too.

### New widgets

- **Desktop icons** - the contents of your desktop folder, drawn on the grid beside
  everything else. Off by default; turn it on with **Show Desktop Icons** on the
  Global Settings page. Entries come and go as you add and remove files, and each one
  keeps the position you drag it to. Removing an icon only takes it off the grid, it
  never touches the file, and **Restore Hidden Icons** puts it back where it was.
  - Double-click opens. The right-click menu holds **Open in Files**,
    **Open With…**, **Open**, **Cut**, **Copy**, **Move to…**, **Copy to…**,
    **Show in Files**, **Open in Console**, **Rename…**, **Move to Trash**,
    **Properties** and **Remove from Desktop**.
  - **Open With…** is a dialog of every installed application, with a filter box and
    the current default first, the way Desktop Icons NG does it. A submenu could only
    list what is registered for that file type.
  - Cut and Copy write the standard URI list and cut flag, so a cut pasted into Files
    moves rather than copies. The icon dims while a cut is waiting, and dims less for
    a copy.
  - Move to… and Copy to… pick a folder through the portal, and count up a name that
    is taken instead of replacing it.
  - Open in Console looks for a terminal among the nine common ones, and asks it for a
    tab as well as a directory. GNOME Terminal and GNOME Console run as one instance
    and ignore the second request otherwise.
  - Renaming keeps the icon in place and refuses a name that is taken. The refused
    name stays on screen with the reason beside it, so it can be corrected in place.
    The prompts confirm on Return and cancel on Escape.
  - **Properties** asks the file manager to open its own window over the freedesktop
    `FileManager1` bus interface, the way Desktop Icons NG does. Gridgets only draws a
    dialog of its own when nothing on the bus answers. GNOME 43 moved the real one into
    Files and stopped shipping `nautilus-properties`, which left nothing to spawn.
  - Right-clicking the empty desktop adds **New Folder**, **Paste** and **Show Hidden
    Files**, so files copied or cut in Files can be pasted onto the grid and dotfiles
    can be shown.
- **News** - a scrolling list of headlines from many publishers, each with its
  thumbnail. Pick a genre when you add it.
- **Calendar Events** - a month grid with the selected day's events listed beside it.
  Double-click a day in the grid to switch to it, scroll the list for the rest, and
  click any of them to open GNOME Calendar.

### Widgets

- The calendar shows events as dots and has arrow buttons to move between months.
  Clicking it opens GNOME Calendar.
- The Top Stories widget is now called **News**, and sits its first headline closer to
  the heading whichever genre it is showing. The genres keep their own names, so the
  default one is still called Top Stories inside it. Its heading icon follows the genre
  too, so each one is recognisable at a glance.
- Clicking the time or world clock widget opens GNOME Clock. World clock cities now
  come from GNOME Shell, so you add them in GNOME Clocks rather than in Gridgets.
- The world clock takes between 2 and 4 cities and draws one row for each, so you
  choose how many to show instead of being fixed at three. Add and remove them from
  the widget settings.
  The list starts at two cities. City rows no longer name a city that has been
  deleted from GNOME Clocks: the dropdown has already fallen back, so naming the
  absent city read as an error where nothing had failed.
  Refreshing the city list no longer clears what you have chosen. It used to reselect
  the city the row was opened with, so a refresh, or opening GNOME Clocks to add a
  city, threw away your other picks.
- Screen time is counted even when no app is focused. Those gaps never reached your
  digital wellbeing total before. Clicking the screen time widget opens that page in
  Settings.
- The notes editor is no longer rebuilt on every resize, which used to lose keyboard
  focus while you were typing.
- The github activity widget has a new layout, and the rss headlines widget had some
  small tidy ups.
- System dashboard cards scale their padding, corners and spacing when you resize
  them, instead of staying as they were when created.
- Media captions got a "use the global setting" switch, and the loading text now
  scales with the widget.
- Image and slideshow captions can sit on a dark fade, so they stay readable over a
  light picture. It is off by default, under Caption Scrim in the global settings.
- Image and slideshow captions can show the picture's date instead of a caption you
  type yourself, under Use Image Date.
- Captions pick where their text comes from: the file name, the folder name for
  slideshows, the image date, or your own text. A folder name is only offered for
  slideshows, which are the only ones with a folder to name.
- Caption colour is its own setting, separate from the widget's text colour, with a
  Caption Text Color row in the global settings. Widgets follow it by default, and
  keep a per-widget colour only if you turn that switch off.
- Right-click an image or slideshow widget to change its picture or folder without
  opening the settings.
- The time widget can show a city from GNOME Clocks instead of local time. Pick one
  when you add the widget or later under City; Local Time is the default.
- The time widget has a new look: a ring of tick marks around the edge with a bright
  one marking the current second, and the time in large type in the middle. The date
  is gone; AM and PM now sits above the time.
- The calendar's weekday bar and date panel now round their corners to match the
  widget, which they did not before.

### Fixes

- The time and world clock widgets no longer leave the displayed minute behind. They
  could update half a minute late, or skip a minute entirely, because the timer they
  used checked a 60 second interval rather than the clock.
- The Open GNOME Clocks button in the world clock and time widget settings did
  nothing. It now opens GNOME Clocks.
- The world clock no longer prints a city's name beside the wrong time. A city saved
  without a timezone was drawn as if it were your local time. It is now left out, and
  the row is filled from the defaults instead.
  Its cities are read from a single clock reading too, so two rows can no longer
  straddle a minute boundary and show different minutes.
- The world clock's type is larger at every size, because it was being scaled against
  a reference box wider than the square face it draws into.
  The Time & Date widget is now called **Clock**, since it shows no date.
  The rows no longer run into the edge of the cell: the face is inset by a padding
  that scales with the type, and the padding used to be a fixed 20px that never moved
  with the widget.
  Four cities on the small cell now step the time down instead of running the rows
  together. The city name keeps its minimum size, so the smaller time is the only
  thing that gives.
- Music artwork no longer vanishes if you change settings while something plays, and it
  now reloads when the player changes track.
- The elapsed time labels no longer go back to full brightness after a resize.
- The music progress bar line is visible against the background again.
- The small music player can be read on light themes, which dark text on a dark
  overlay had made impossible.
- Widgets no longer try to resize themselves using broken sizes during startup or
  teardown, which could produce a widget with no size at all.
- Pictures stop loading if their widget is deleted, and no longer log an error for a
  widget that is already gone.
- System readings stop being fetched when nothing is watching them.
- RSS headlines now keep their items when a widget is rebuilt, instead of briefly
  showing nothing.
- The clipboard widget now works out its card and highlight colours once instead of
  twice.
- Music keeps its position and cover when the grid is rebuilt.
- The todo widget no longer starts with three made-up tasks in it. A todo list saved
  under the old file name is moved over rather than left behind.

Two known problems from `v0.9.4-beta` are fixed here: some widgets scaled their text
wrongly, and music artwork could disappear.

### Internals

- Desktop icons are saved as ordinary entries in the widget layout under a type of
  their own, so the grid's existing drag, collision and persistence paths carry them
  with nothing extra to maintain. A new `nextWidgetIdFromList` helper hands out ids
  against a list a caller already holds, which is what adding several entries in one
  pass needs.
- Gridgets now warns in the journal when an extension that also draws desktop icons is
  enabled alongside it, naming the other extension.
- Desktop icon operations are split across three small modules by what they need: the
  folder reconciliation is gi-free so the preferences process can reach it, the file
  operations need only Gio, and the clipboard paste needs St.
- Shared helpers were pulled out instead of being copied around: text size and weight
  settings, telling a click apart from a drag, the small graphs used by the system
  widgets, and the button styling on the pomodoro timer.
- The CPU, RAM and network widgets share one implementation of their graph row instead
  of having three almost identical copies.
- The grid now works out its own size when it starts, instead of falling back to an
  old fixed number, and it redraws when the new colour settings change.
- Removed the fake mood and fake screen time data generators.
- Removed unused code and a few settings that were read but never used.
- The minute timer both clock widgets use now checks the clock instead of counting 60
  seconds, and its tick lands just after the minute rather than on it.
- Removed two exports from the time widget's index that nothing imported.

### Documentation

- The README now has a Widget Requirements section, a Known Limitations section, a
  NixOS section covering which packages to install, and a note about browsers taking
  over as the music player.
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
