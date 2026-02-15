# Ink Capabilities Reference

## Scope

Use this reference to choose Ink primitives, hooks, and render lifecycle APIs.

## Runtime and Installation

- Require Node.js `>=20`.
- Require React `>=19`.
- Install with `npm install ink react`.
- Bootstrap quickly with `npx create-ink-app@latest`.

## Core Components

Use these primitives from Ink core:

- `Box`: Flexbox layout container.
- `Text`: Styled terminal text.
- `Newline`: Manual line break.
- `Spacer`: Fill remaining horizontal space.
- `Static`: Print immutable log output above dynamic UI.
- `Transform`: Post-process each rendered line before display.
- `MeasureElement`: Measure rendered width/height for adaptive layouts.

## Core Hooks

- `useInput`: Capture keyboard input.
- `useApp`: Control app lifecycle (`exit`).
- `useFocus`: Mark and query focus state.
- `useFocusManager`: Move focus between components.
- `useIsScreenReaderEnabled`: Adapt UI for assistive technologies.
- `useStdin`: Access stdin stream and TTY mode state.
- `useStdout`: Access stdout stream.
- `useStderr`: Access stderr stream.
- `useStdoutDimensions`: Track terminal dimensions.

## Render API

`render(<App />, options)` returns an instance with lifecycle methods.

### Render options

- `stdout`: Target writable stream.
- `stdin`: Target readable stream.
- `debug`: Forward output to stderr for debugging.
- `exitOnCtrlC` (default `true`): Exit app on Ctrl+C.
- `patchConsole` (default `true`): Patch `console.*` to avoid corrupting UI.
- `waitUntilExit`: Keep process alive until explicit exit.

### Instance methods

- `rerender(node)`: Update root tree.
- `unmount()`: Unmount and restore terminal.
- `clear()`: Clear output.
- `cleanup()`: Clear and unmount.
- `onRender(cb)`: Run callback after each render.

### String rendering

Use `renderToString(node)` for non-interactive output (CI/docs/tests).

## Accessibility and CI

- Use `useIsScreenReaderEnabled` to switch to screen-reader-friendly output.
- Prefer stable, non-interactive rendering in CI pipelines.
- Avoid cursor-heavy animations in non-TTY contexts.

## Testing

Use `ink-testing-library` for behavior tests and snapshots.

- Assert visible output with query helpers.
- Simulate keyboard input deterministically.
- Keep plugin command handlers unit-testable outside Ink render tree.

## Source Index

- Ink repository and README: https://github.com/vadimdemedes/ink
- Create Ink App: https://github.com/vadimdemedes/create-ink-app
