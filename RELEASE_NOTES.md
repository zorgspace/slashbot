# Release Notes - v1.2.0

This release includes several enhancements to Slashbot, focusing on improved autonomy, UI refinements, and expanded capabilities.

## Commits Since v1.1.0

- feat: enhance agentic loop with better error recovery and context compression
- fix: resolve typecheck errors in action handlers
- docs: update GROK.md with comprehensive project documentation
- feat: add sticky plan display for multi-step task tracking
- refactor: improve DI container bindings for better modularity
- feat: implement auto-update mechanism for seamless upgrades
- fix: correct permissions checks in file operations
- feat: add image support and vision model integration
- refactor: optimize connector initialization and message handling
- feat: introduce process management with /ps and /kill commands
- docs: expand context persistence guidelines
- fix: handle edge cases in XML action parsing
- feat: enhance scheduler with LLM-powered tasks
- refactor: clean up unused imports and improve code formatting
- feat: add support for custom skills installation via URLs
- fix: improve graceful shutdown and signal handling
- docs: add detailed architecture and development guides

## What's New

- **Enhanced Agentic Workflows**: Improved iteration and error handling in the agentic loop.
- **UI Improvements**: Sticky plan display for better task progress tracking.
- **Image Support**: Analyze images and integrate with vision models.
- **Process Management**: List and kill background processes directly from CLI.
- **Auto-Updates**: Check and install updates automatically.
- **Expanded Skills**: Install custom skills from URLs for specialized tasks.

## Bug Fixes

- Resolved typecheck errors across multiple modules.
- Fixed permissions issues in file operations.
- Corrected XML parsing edge cases.

## Breaking Changes

None in this release.

---

Released on: 2026-02-02
Co-authored-by: Slashbot
Co-authored-by: xAI (Grok)