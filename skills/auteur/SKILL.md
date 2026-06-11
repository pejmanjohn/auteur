---
name: auteur
description: Generate a UI/design by sending a prompt to claude.ai/design and getting a ready-to-implement handoff back. Use when a task needs a visual/UI design, mockup, landing page, component, or HTML page generated before implementing it.
---

# auteur

auteur runs a design prompt through **claude.ai/design** (via a signed-in browser it
automates for you) and returns the exact **"Send to Claude Code" handoff** — a URL plus
an `Implement:` line — that you then act on. No API keys; it uses the browser session.

## When to use

Reach for auteur when the user wants something *designed* before it's built: a landing
page, pricing page, dashboard, empty state, form, marketing section, component, etc.
auteur gets you a polished, self-contained design + a handoff so you can implement it.

## Usage

```bash
auteur "<describe the design you want>"
```

Example:

```bash
auteur "A pricing page for a SaaS app: three tiers, monthly/annual toggle, light theme"
```

auteur prints a handoff like:

```
Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/<token>?open_file=Pricing.html
Implement: Pricing.html
```

**Then follow that command**: fetch the URL (it returns the design files + a README with
implementation notes) and implement the design in the user's project.

Useful flags:

- `--out <dir>` — also save the generated files locally.
- `--json` — machine-readable output (`handoff.command`, `files`, `projectUrl`).

## First-time / auth

If a run reports **not signed in**, tell the user to run `auteur login` once (a Chrome
window opens; they sign in to Claude). Check status with `auteur doctor`. auteur keeps its
own Chrome profile — the user's normal browser is untouched.

## Notes

- Generation takes ~30–120s; auteur waits and reports live progress on stderr.
- The handoff URL is fetched **server-side** by your agent (e.g. WebFetch), not from the
  browser — it carries the full design context and README.
