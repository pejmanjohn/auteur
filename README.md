# auteur 🧑‍🎨

> Whisper a design prompt to Claude Design, get the design back to your coding agent.

auteur is a tiny CLI that turns a prompt into a finished design from
[claude.ai/design](https://claude.ai/design) — and hands it to your coding agent ready to
build. It drives a real, signed-in Chrome for you, so there's no copy-paste, no clicking
through the web app, and **no API keys**. It's [oracle](https://github.com/steipete/oracle),
but for design instead of ChatGPT.

```console
$ auteur "A pricing page for a SaaS app, three tiers, light theme, one accent color"
› Creating project…
› Claude Design is generating… (38s, 1 file)
› Minting handoff…

  ✦ Claude Design is done.

  Project   https://claude.ai/design/p/4942143a-14c1-4376-837e-2f6ea1b3a082
  Files     Pricing.html (16.2 KB)

  ── Hand this to your coding agent ───────────────────────────────────────

  Fetch this design file, read its readme, and implement the relevant aspects
  of the design. https://api.anthropic.com/v1/design/h/SbzZ…?open_file=Pricing.html
  Implement: Pricing.html
```

That last block is the exact **"Send to Claude Code" handoff** the in-app **Share** button
produces. Your agent fetches the URL, reads the design files and their README, and implements
them — no human in the loop.

## Quickstart

```bash
# 1. Install from GitHub  (requires Node 20+ and Google Chrome)
npm install -g pejmanjohn/auteur

# 2. Sign in once  (opens a Chrome window using auteur's own profile)
auteur login

# 3. Ask for a design
auteur "A dashboard empty-state with an illustration and a primary CTA"
```

`auteur login` is a one-time step. auteur uses a **dedicated** Chrome profile
(`~/.auteur/chrome-profile`) — your everyday browser, tabs, and logins are never touched —
and keeps it running in the background so every later run is instant and stays signed in.

## Why

Getting a Claude design into a coding agent is a manual chore today: open the site, create a
project, type the prompt, wait, click **Share → Send to Claude Code**, copy the command, paste
it back into your agent. auteur collapses that whole loop into one command your agent can run
itself — the same way oracle made "ask GPT-5 Pro" a single command.

## Commands

| Command | What it does |
|---------|--------------|
| `auteur "<prompt>"` | Generate a design and print a handoff (this is the default) |
| `auteur login` | Sign in to Claude in auteur's dedicated Chrome profile (one time) |
| `auteur doctor` | Check Chrome and sign-in status |
| `auteur stop` | Close auteur's background Chrome |
| `auteur skill install` | Add the `/auteur` skill to Claude Code and Codex ([details](#type-auteur-in-your-coding-agent)) |

```bash
auteur -p "404 page, dark theme, monospace accents" --out ./designs   # also save the files
auteur "mobile onboarding screen" --json                              # machine-readable output
auteur --project "Skillet" "a settings page matching the theme"       # design into an existing project
auteur --variations 3 "a hero section for a coffee brand"             # 3 variants to flip in the Tweaks panel
echo "a glassy weather widget" | auteur                               # prompt via stdin
```

Generation usually takes **30–120s**; auteur watches Claude's live progress (not a fixed
timer) and prints status as it goes.

## Options

| Flag | Description |
|------|-------------|
| `-p, --prompt <text>` | The design prompt (or pass it positionally, or via stdin) |
| `-o, --out <dir>` | Write the generated design files to `<dir>` |
| `--variations <n>` | Generate **N flippable variants in one design** (2–5) via Claude Design's Tweaks panel, instead of separate runs that overwrite each other |
| `--project <ref>` | Design into an **existing** project (name, URL, or id) so it matches that project's theme/design system, instead of creating a new one |
| `--name <name>` | Name a newly-created project (ignored with `--project`) |
| `--json` | Emit JSON (`handoff`, `files`, `projectUrl`) instead of prose |
| `--timeout <sec>` | Max seconds to wait for generation (default `240`) |
| `--headless` | Launch Chrome headless (no visible window) |
| `--quit` | Close Chrome when done (default: keep it warm for reuse) |
| `--port <n>` | Chrome DevTools port (default `9322`) |

## How it works

1. **Attach** to auteur's dedicated Chrome over the DevTools Protocol, launching it if it
   isn't already running. The browser holds your claude.ai session, so auteur never sees or
   stores credentials or tokens.
2. **Create** a project, **send** the prompt through the design composer, and **wait** for
   generation — detecting completion from the page's live busy state, then settling once the
   generated files stop changing.
3. **Collect** the files and **mint a handoff token** through Claude Design's own internal API.
4. **Print** the "Send to Claude Code" handoff — identical to the in-app **Share** button —
   plus the project URL and file list.

Every step runs through the page's own authenticated session (Claude Design's internal
`OmeletteService` API), so auteur is about as reliable as the website itself. The only thing
done through the visible UI is typing the prompt — Claude builds the full request from there.

## Type `/auteur` in your coding agent

auteur ships a skill so you can invoke it as a first-class command. Install it into both
Claude Code and Codex with one command:

```bash
auteur skill install
```

This symlinks the skill into `~/.claude/skills/auteur` and `~/.codex/skills/auteur` (whichever
you have). The skill and the `auteur` CLI install separately — make sure the CLI itself is also on
your `PATH` (`npm install -g pejmanjohn/auteur`, or `npm link` from a clone), or the skill will load
but `auteur` won't be found. Open a new session, then:

- **Claude Code** — type `/auteur a pricing page for a SaaS app`. It runs auteur and implements
  the handoff it returns.
- **Codex** — just ask for a design ("design a pricing page"); Codex reaches for auteur on its
  own, the same way it uses any skill.

A single `SKILL.md` drives both — both CLIs read the same `name`/`description` frontmatter and
Markdown. Manage it with:

```bash
auteur skill              # show where it's installed
auteur skill install --claude   # or --codex to target just one
auteur skill install --copy     # copy the files instead of symlinking
auteur skill uninstall          # remove it
```

Prefer not to install a skill? Add this to your `AGENTS.md` / `CLAUDE.md` instead:

```
- auteur runs a design prompt through claude.ai/design and returns a ready-to-implement
  handoff. Use it whenever a task needs UI/a design generated first:
  `auteur "<what to design>"`, then follow the printed "Fetch this design file…" command.
- Run `auteur doctor` once per session; if it reports not signed in, ask the user to run
  `auteur login`.
```

Either way, the handoff URL is meant to be fetched **server-side** by the agent (e.g. Claude
Code's `WebFetch`), not from a browser — it carries the full design context and README.

## Troubleshooting

- **"Not signed in to claude.ai…"** — run `auteur login` and sign in. Check anytime with
  `auteur doctor`.
- **Generation seems slow** — that's normal (30–120s). auteur waits for Claude to finish;
  use `--timeout` to allow longer.
- **Don't want a visible window** — add `--headless`.
- **Chrome stays open after a run** — that's intentional; it keeps your session warm. Close
  it with `auteur stop`, or run a one-off with `--quit`.
- **Port 9322 is taken** — pick another with `--port`.

## Requirements

Node 20+ and Google Chrome. Works on macOS, Linux, and Windows.

## License

MIT
