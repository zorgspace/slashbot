# Ink Ecosystem Components

## Scope

Use this reference to pick extension-ready packages before writing custom UI.

## Input and Selection

- `ink-text-input`: Single-line text input.
- `ink-select-input`: Arrow-key selection list.
- `ink-multi-select`: Multi-select lists.
- `ink-autocomplete-input`: Interactive autocomplete.
- `@inkjs/ui`: Maintained component suite from Ink author.

## Structured Output

- `ink-table`: Simple table rendering.
- `ink-data-table`: Data-focused tables.
- `ink-gradient`: Gradient text.
- `ink-big-text`: Banner-style text.
- `ink-spinner`: Activity spinners.

## Navigation and Command UX

- `pastel`: Full CLI framework built on Ink.
- `ink-confirm-input`: Yes/no prompt.
- `ink-color-pipe`: Colorize shell command output.

## Terminal and Runtime Utilities

- `ink-use-stdin-dimensions`: Track terminal dimensions.
- `ink-link`: Clickable links.
- `ink-image`: Render images in terminal.
- `ink-markdown`: Render Markdown.

## Selection Criteria

1. Prefer actively maintained packages.
2. Prefer packages with TypeScript types.
3. Prefer packages exposing controlled state APIs.
4. Wrap third-party components behind local adapters for easier replacement.

## Integration Pattern

1. Create a local wrapper component in `src/ui/adapters`.
2. Keep third-party props localized to that wrapper.
3. Export internal props contracts from your codebase.
4. Replace internals later without touching command logic.

## Source Index

- Ink README ecosystem list: https://github.com/vadimdemedes/ink
- Ink UI components: https://github.com/vadimdemedes/ink-ui
- Pastel framework: https://github.com/vadimdemedes/pastel
