# T3 Code (Fork)

A fork of [T3 Code](https://github.com/pingdotgg/t3code) — a minimal web GUI for coding agents (Codex and Claude).

**Fork by:** [Caleb Russel](https://github.com/calebrussel77)
**Repo:** [github.com/calebrussel77/t3code](https://github.com/calebrussel77/t3code)

## Extra features (not in the upstream repo)

- **Skill system with `$`-trigger** — Type `$SkillName` in the composer to insert skill tokens rendered as inline chips. Skills are loaded from global (`~/.claude/skills`, `~/.agents/skills`) and project-level directories for both Claude and Codex providers.

- **Usage dashboard** — A Settings > Usage page showing live session and weekly quota utilization for both Claude and Codex, with progress bars, plan labels, reset times, and a refresh button.

- **Multi-agent status widget** — Collapsible widget above the composer when Codex spawns sub-agents. Shows each agent's prompt with live status icons and completed/total count. Claude `task` sub-agents render inline in the timeline with expandable tool lists.

- **Enhanced tool call timeline** — Expandable tool output panels with command/input/output sections. MCP tool names parsed into readable `server / action` labels. Reasoning updates grouped into collapsible rows with a "Show more" limit. Consistent flat design across standalone tools, sub-agent tools, and reasoning groups.

- **Appearance / typography settings** — UI and code font family pickers, font size controls (10–24px, 0.5px steps), persisted to localStorage and applied as CSS custom properties.

- **Shell command simplification** — Windows shell wrappers (`powershell -Command`, `cmd /c`) are unwrapped for cleaner display in tool call rows.

- **Sidebar improvements** — Folder icons for projects, drag-to-reorder projects via DnD, and toggleable project thread lists.

- **Win32 compatibility** — Path handling and test compatibility fixes for Windows.

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/calebrussel77/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Notes

We are very very early in this project. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)
