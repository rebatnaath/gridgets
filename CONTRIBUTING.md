# Contributing to Gridgets

Thank you for your interest in contributing to Gridgets. This guide covers how to report issues, request features, and submit code changes.

## Code of Conduct

This project is committed to providing a welcoming and inclusive experience for everyone. By participating, you agree to respect all contributors regardless of background or level of experience. Harassment and disrespectful behavior are not tolerated.

If you experience unacceptable behavior, report it by opening an issue or contacting the maintainers privately.

## Reporting bugs

Before reporting a bug, please:

- Search the [issue tracker](https://github.com/rebatnaath/gridgets/issues) for an existing report.
- Include the GNOME Shell version and your desktop environment (Wayland or X11).
- Describe the expected behavior and the actual behavior.
- Include any relevant errors from the GNOME Shell log, for example:

```bash
journalctl /usr/bin/gnome-shell -f
```

## Requesting features

Open an issue and describe the feature you would like to see, the problem it solves, and any relevant examples. Clear, focused requests are more likely to be addressed.

## Submitting changes

### 1. Fork & branch

Fork this repository, then create a new branch for your changes:

```bash
git checkout -b feature/my-feature
```

Keep branches focused on a single change, and base them on the latest `main`.

### 2. Make changes

Write clean, well-documented code. Follow the [Coding conventions](#coding-conventions) and run the [Validation](#validation) checks before committing. Where a change can be tested, verify it before opening a pull request.

### 3. Commit & push

Commit each logical change separately with a clear message (see [Commit guidelines](#commit-guidelines)), then push your branch:

```bash
git push -u origin feature/my-feature
```

### 4. Open a pull request

Open a pull request from your branch to `main`, describing the change, the motivation, and any testing you performed.

## Coding conventions

- Write in standard ECMAScript (ES modules). The extension runs in the GJS runtime used by GNOME Shell.
- Keep functions small and focused, and use descriptive names.
- Prefer explicit ownership over defensive checks:
  - Do not wrap `destroy()`, `disconnect()`, or `GLib.source_remove()` in unnecessary `try/catch`.
  - Avoid optional-call `?.()` and `typeof === 'function'` guards unless they solve a real runtime issue.
- Dispose of actors cleanly. When a widget subscribes to signals or schedules timers, ensure they are removed on destroy to avoid errors on disposed objects.
- Maintain the single-loop polling model: reuse the shared background polling loop rather than adding per-widget timers.
- Add no emojis or promotional language; keep comments focused on the "why", not the "what".

## Validation

There is no build step. Lint the JavaScript syntax of any changed file before committing:

```bash
node --check path/to/file.js
```

When you cannot run the extension, at minimum confirm the changed files pass `node --check` and note in the pull request what you could not test. After testing, confirm the extension loads without errors and that widgets can be added, resized, styled, and removed.

## Commit guidelines

- Write commits in the imperative mood (for example, "Fix widget resize handle positioning").
- Keep commits small and focused on a single change.
- Reference any related issue numbers in the commit message or pull request description.
- Do not commit secrets or built artifacts.

## Review

Maintainers review pull requests for correctness, clarity, and adherence to the conventions above. Ensure your pull request description states what changed and how you verified it. Be responsive to review comments so the change can be merged.