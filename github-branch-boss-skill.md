# GitHub Branch Management: Master Branching Like a Boss

## Overview

As a software developer managing branches like a pro, this skill provides best practices, essential commands, and strategies for efficient GitHub branch handling. Focus on clean history, collaboration, and avoiding common pitfalls.

## Best Practices

- **Naming Conventions**: Use descriptive names like or . Avoid generic names; prefix with type (feature/, hotfix/, refactor/).
- **Branch from Main**: Always create branches from or to ensure stability.
- **Keep Branches Short-Lived**: Merge or delete branches after PR approval to prevent clutter.
- **Use Pull Requests**: Never push directly to main; use PRs for code review and CI checks.
- **Rebase Over Merge**: Prefer rebasing for linear history, but merge for preserving context.
- **Protect Main Branch**: Enable branch protection rules: require PRs, status checks, and reviews.
- **Squash Commits**: Squash feature branches into one commit when merging to keep history clean.

## Essential Commands

- Create and switch to new branch:
- Push branch to remote:
- Update branch from main:
- Delete local branch:
- Delete remote branch:
- View all branches:
- Track remote branch:

## Advanced Strategies

- **Git Flow**: Use for releases, for integration, feature branches for work.
- **Cherry-Picking**: For hotfixes, cherry-pick commits to main without full merges.
- **Interactive Rebase**: Clean up commits with to squash, edit, or reorder.
- **Conflict Resolution**: Resolve locally before pushing; use if needed.
- **Branch Cleanup**: Regularly run to identify deletable branches.
- **Tagging Releases**: Use for versioning.

## Pro Tips

- Use GitHub CLI: for quick PRs.
- Automate with Actions: Set up auto-merge on CI pass.
- Monitor with Dashboards: Use GitHub Insights for branch health.
- Collaborate Effectively: Assign reviewers, add labels, and use issues for tracking.
- Avoid Force Pushes: Only use on personal branches.

## Common Pitfalls to Avoid

- Pushing broken code to main.
- Long-running branches causing merge conflicts.
- Not deleting merged branches.
- Ignoring CI failures.
- Overwriting history without coordination.

Master these to branch like a boss and keep your repository pristine.
