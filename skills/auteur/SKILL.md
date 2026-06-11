---
name: auteur
description: Generate a UI/design — landing page, pricing page, dashboard, form, empty state, component, mockup — by sending a prompt to claude.ai/design via the auteur CLI, then implement the handoff it returns. Use whenever a task needs a visual/UI design produced before (or instead of) writing the markup by hand.
argument-hint: "[what to design]"
allowed-tools: Bash(auteur:*), WebFetch
---

# auteur — design with Claude, implement the handoff

`auteur` runs a design prompt through [claude.ai/design](https://claude.ai/design) (driving a
signed-in browser, no API keys) and prints the **"Send to Claude Code" handoff** — a URL plus an
`Implement:` line. Your job is to run it and then build what it returns.

## When to use

Reach for auteur whenever the user wants something **designed** before it's built: a landing
page, pricing page, dashboard, empty state, form, marketing section, component, or mockup. It
returns a polished, self-contained design plus an implementation-ready handoff.

## How to run it

Run the CLI with the user's request as the prompt. In Claude Code, the text after `/auteur` is
the request; otherwise use what the user described.

```bash
auteur "<the design request>" --out ./designs
```

- `--out <dir>` saves the generated files locally (handy if you want to read/adapt them directly).
- `--json` gives machine-readable output (`handoff`, `files`, `projectUrl`) if you'd rather parse it.
- `--project <ref>` designs into an **existing** Claude Design project so the result matches that
  project's theme/design system, instead of creating a new one.

Generation takes ~30–120s; auteur prints live progress and exits when done. If the user gave no
specific request (bare `/auteur`), ask what they'd like designed before running.

### Designing into an existing project

When the user wants the design to stay consistent with an existing project — they say things like
"use the **Skillet** project", "in my Skillet design", or paste a `claude.ai/design/p/...` link —
pass that reference to `--project`:

```bash
auteur --project "Skillet" "<the design request>"
auteur --project "https://claude.ai/design/p/019de1b4-...?file=Skillet.html" "<the design request>"
```

`--project` accepts a project **name** (exact, case-insensitive), a **URL**, or a bare **id**. If a
name is unknown or ambiguous, auteur errors and lists the candidate projects with their URLs — relay
that to the user so they can pick, or use the URL.

## What you get back, and what to do with it

auteur prints a handoff like:

```
Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/<token>?open_file=Pricing.html
Implement: Pricing.html
```

Then **follow that command**:

1. **Fetch the handoff URL** (e.g. with WebFetch). It returns the design files and a README with
   implementation notes — that's the full context, richer than the saved HTML alone.
2. **Implement** the design in the user's project: translate it into their stack/components,
   matching the structure and styling from the design + README.
3. If you passed `--out`, you can also read the saved files locally as a reference.

The handoff URL is meant to be fetched **server-side** (WebFetch), not opened in a browser.

## Auth (first run)

If auteur reports **"Not signed in to claude.ai…"**, tell the user to run `auteur login` once (a
Chrome window opens for them to sign in). Check status anytime with `auteur doctor`. auteur uses
its own dedicated Chrome profile, so the user's normal browser is untouched.

## Notes

- auteur keeps its Chrome running between calls so repeat runs are fast; `auteur stop` closes it.
- Treat the design as a starting point: implement faithfully, but adapt to the project's existing
  conventions, components, and accessibility needs.
