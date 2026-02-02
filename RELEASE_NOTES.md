# Release Notes - v1.2.1

## Overview
This release introduces significant improvements to the terminal UI, API robustness, and overall user experience for Slashbot, the autonomous AI CLI agent.

## Features
- **Enhanced Terminal UI**: Added markdown support for better formatting and readability in the terminal interface.
- **API Robustness Improvements**: Implemented token limit recovery mechanisms to handle API rate limits more gracefully.
- **Process Management**: Added capabilities for managing background processes within the CLI environment.
- **Executed Actions Tracking**: Introduced tracking of executed actions in the agentic loop to improve response validation and reliability.
- **Documentation Updates**: Comprehensive updates to project documentation and enhancement of user guides.

## Refactors
- **Plan Management System Removal**: Removed the previous plan management system and integrated a new "say" action for improved communication flow.

## Documentation
- **Git Workflow Enhancements**: Expanded git workflow instructions with detailed steps for analysis and context reading to ensure better version control practices.

## Technical Details
- **Agentic Loop Improvements**: The core agentic execution loop now tracks actions more accurately, reducing errors and improving consistency.
- **UI Components**: Terminal UI components have been modernized with better markdown rendering support.

## Compatibility
This release maintains backward compatibility with existing configurations and skills. No breaking changes to the API or command structure.

## Installation
To update to v1.2.1, pull the latest changes and rebuild:
```bash
git pull
bun install
bun run build
```

---

*Co-authored-by: Slashbot*  
*Co-authored-by: xAI (Grok)*