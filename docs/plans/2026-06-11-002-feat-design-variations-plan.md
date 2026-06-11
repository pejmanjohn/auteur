---
title: "feat: Multi-variation designs via --variations (native Tweaks)"
status: completed
date: 2026-06-11
type: feat
plan_depth: standard
---

# feat: `--variations N` (native Tweaks)

## Summary

Add a first-class `--variations N` flag so a **single** Claude Design generation produces N flippable
variants under one design — using Claude Design's native **Tweaks** flow — instead of running auteur
multiple times (which produced independent designs that overwrote each other and never appeared as
flippable variants).

Recon (against the live Claude Design bundles) settled the central unknown: Tweaks are **parametric
variants the model bakes into one design when the prompt asks for them**, not a callable API. The
in-app Tweaks UI itself just sends a natural-language message (`"Add tweakable controls to <X>"`),
and Claude Design's own system prompt says *"When the user asks to make something tweakable (colors,
variants, toggles, copy), declare…"*. So the only lever auteur has is **prompt augmentation** —
`--variations N` appends an instruction telling Claude Design to make the layout a tweakable variant
with N options. One generation, one file, N variants flippable in the Tweaks panel. (Per user
decisions: native Tweaks only — no separate-files mode — and no overwrite warning.)

---

## Problem Frame

A user wanted three landing-page variations to compare and flip between. auteur was run three times
into the same `--project`; each run was an independent generation, Claude Design named the output
file the same each time (`Office Hours - Landing.html`), so each run overwrote the previous file, and
three independent generations are **not** tweaks, so they never appeared in the Tweaks panel for
side-by-side flipping.

The root gap: **there is no native-variations path.** "N flippable variants" only exist *within* one
generation; repeated runs cannot produce them. Giving users a one-run `--variations N` removes the
reason to multi-run into a project (which is what caused the overwrites), so the fix is to make the
correct path easy rather than to police the wrong one. (A warning when a run overwrites an existing
file was considered and **declined** — it would fire on legitimate "iterate on an existing design"
runs and be too noisy.)

---

## Requirements

- **R1.** `--variations N` (N ≥ 2) augments the design prompt so **one** generation yields N flippable
  variants in a single design (Claude Design's Tweaks panel).
- **R2.** Absent, or N ≤ 1 → today's behavior exactly (no prompt augmentation).
- **R3.** Still one generation and one design file; the result/handoff shape is unchanged. Human
  output notes the variant count and that they flip in the Tweaks panel (with the project URL);
  `--json` includes `variations: N`.
- **R4.** A spike confirms the prompt-augmentation template reliably produces real Tweaks-panel
  variants (not just prose describing variants); the working template is captured.
- **R5.** `N` is validated/clamped to a sane range (proposed 2–5), with a clear message when out of range.
- **R6.** Docs: SKILL.md steers agents to prefer `--variations N` (one run) over repeated runs into the
  same project for A/B work; README gains the flag + a "compare variations" example.

---

## Key Technical Decisions

- **KTD1 — Variations via prompt augmentation (there is no variations API).** Grounded in recon: the
  Tweaks system is prompt-declared (`TweaksPanel`/`TweakSelect`/`VariantNumeric`/`tweakable`, with
  **no `GenerateVariations` RPC** — only `ReleaseTurn` surfaced as an `OmeletteService/*` method), the
  Tweaks UI sends `"Add tweakable controls to <X>"` messages, and the design model's system prompt
  declares tweakables on request. So `--variations N` appends a natural-language instruction to the
  user's prompt; Claude Design produces one design whose key layout/sections are a tweakable variant
  with N options. This is exactly how the native flow is driven from inside the product.

- **KTD2 — Spike-first to confirm reliability and lock the template.** Because the behavior is
  prompt-dependent, the first unit runs a real `--variations` generation and confirms the Tweaks panel
  shows N flippable variants before the template is finalized. If augmentation under-delivers (model
  writes prose variants but doesn't *declare* Tweak variants), the wording is tuned to mirror the
  product's own phrasing (`"make <section> tweakable with N variants"`). The template lives behind a
  pure helper so the live behavior is the only execution-time unknown.

- **KTD3 — One generation, not N.** `--variations` is a single augmented generation, so it isn't N×
  slower and the variants live under one design and one handoff — matching the Tweaks model and the
  user's "flip between them in the panel" goal.

---

## Implementation Units

### U1. Variations prompt template + feasibility spike

**Goal:** Define the prompt-augmentation that makes Claude Design emit N flippable Tweaks variants in
one design, and confirm it actually works.

**Requirements:** R1, R4, R5.

**Dependencies:** none.

**Files:**
- `src/design.js` — add and export `variationsInstruction(n)` (pure; returns the augmentation string
  for `n ≥ 2`, `""` for `n < 2`; clamps `n` to the supported range).
- `test/variations.test.js` — unit test for the helper (string assembly + clamping + empty cases).

**Approach:** The helper returns an instruction appended to the user's prompt, e.g. (wording to be
confirmed/tuned in the spike): *"Produce this as ONE design with N distinct variations of the main
layout. Make the hero and key sections a tweakable variant with N options so I can flip between them
in the Tweaks panel — don't create separate files."* Mirror the product's own phrasing
(`"make <section> tweakable with N variants"`) surfaced in recon.

**Execution note:** Spike-first — run a real `--variations 3` generation into a throwaway project and
open the Tweaks panel to confirm 3 flippable variants appear (not just prose). Tune the wording until
it reliably declares Tweak variants; record the final template. The spike validates live behavior; the
unit test only covers the deterministic string assembly.

**Patterns to follow:** Co-locate with the other pure helpers near the bottom of `src/design.js`
(`parseProjectRef`, `selectGenerated`, `handoffCommand`); export likewise.

**Test scenarios** (`test/variations.test.js`):
- `variationsInstruction(3)` contains "3" and references Tweaks/flip/variant and "one design".
- `variationsInstruction(1)` and `(0)` return `""` (no augmentation).
- `variationsInstruction(99)` clamps to the max (e.g. 5) and the string reflects the clamped count.
- Non-integer / `NaN` input → treated as no variations (`""`), not a throw.

**Verification:** Unit test green; the spike shows a real design with N flippable variants in the
Tweaks panel and the working template is captured in the helper.

---

### U2. Wire `--variations N` through the CLI and runDesign

**Goal:** Parse `--variations`, augment the prompt with U1's helper, and surface the variant count in
output.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** U1.

**Files:**
- `src/cli.js` — `parseArgs` (`--variations <n>` → integer), `runCommand` (pass `variations` to
  `runDesign`; include in `--json`), `printHelp` (option + example).
- `src/design.js` — `runDesign` composes `prompt + variationsInstruction(variations)` before sending;
  adds `variations` to the returned result; the human summary notes the count.

**Approach:** When `variations ≥ 2`, the sent prompt is the user prompt plus the augmentation. One
generation as today; the single generated file is the handoff target (it carries the variants). Human
output adds a line like *"N variants — flip them in the Tweaks panel: <projectUrl>"*. `--json` gains
`variations: N`.

**Patterns to follow:** The `--project` / `--name` plumbing added recently (`parseArgs` switch,
`runCommand` → `runDesign` options, `printHelp` table + example).

**Test scenarios:**
- `Test expectation: light` — `parseArgs` is not exported; covered by U1's helper test plus the U1
  spike for live behavior. Manual: `auteur --variations 3 --json "<prompt>"` shows `variations: 3`
  and the augmented intent; `--help` lists `--variations`; `--variations 1` behaves like no flag.

**Verification:** `--help` shows `--variations`; a `--variations 3` run produces one design with three
flippable Tweaks variants (the U1 spike) and the output names the count + panel.

---

### U3. Documentation

**Goal:** Teach the skill and README about `--variations`.

**Requirements:** R6.

**Dependencies:** U2.

**Files:**
- `skills/auteur/SKILL.md` — document `--variations N`; add guidance: for A/B/variations the agent
  should use `--variations N` in **one** run, not multiple runs into the same project (which overwrite
  each other and don't appear as flippable variants).
- `README.md` — add `--variations <n>` to the Options table and a "compare variations" example.

**Approach:** Extend the existing Options table and the SKILL.md "How to run it" / project section in
the established concise voice.

**Test expectation:** none — documentation. Verify by reading the rendered SKILL.md/README.

---

## Scope Boundaries

**In scope:** `--variations N` (prompt-augmented native Tweaks, one design), `N` validation, and docs.

### Deferred to Follow-Up Work
- A separate-files / multi-generation mode (each variation a distinct coexisting file via `WriteFile`)
  — explicitly declined for now in favor of native Tweaks.
- An overwrite warning when a run replaces an existing project file — **declined** as too noisy (it
  would fire on legitimate iterate-on-existing-design runs); `--variations` removes the main reason to
  multi-run into a project.
- Programmatic readback of how many Tweak variants a design actually declared (verifying N from the
  file content rather than trusting the prompt).

### Non-goals
- Building or driving a tweak editor / changing tweak values from the CLI.
- Design-system management; project list/delete/rename.

---

## Risks & Dependencies

- **Prompt-augmentation reliability (highest risk).** Variations are emergent from the prompt, not
  guaranteed by an API. Claude Design may produce fewer variants or describe them in prose without
  declaring Tweak variants. Mitigated by the U1 spike (confirm + tune the template before shipping), by
  mirroring the product's own `"make … tweakable with N variants"` phrasing, and by `N` clamping. If it
  proves unreliable, the deferred separate-files mode is the documented fallback (out of scope here).
- **No existing test harness beyond the new `node:test` files**; this plan adds pure-helper unit tests
  only, keeping with auteur's manual-verification convention for browser-driven paths.

---

## Sources & Research

- **Live recon of Claude Design bundles** (decisive, shaped KTD1/KTD2): `ProjectPage`/`index`/
  `connectrpc` assets contain `TweaksPanel`, `TweakSelect`, `TweakColor`, `TweakSlider`,
  `VariantNumeric`, `variationId`, `variantKey`, `tweakable` — and **no `GenerateVariations` RPC**
  (`ReleaseTurn` is the only `OmeletteService/*` method that surfaced). The Tweaks UI sends
  `"Add tweakable controls to <X>"` messages and the design system prompt declares tweakables on
  request → variations are prompt-driven.
- **Session bug report** (the origin of this work): three runs into one project overwrote the same
  output filename; independent generations don't appear as Tweaks variants.
- **Internal code**: `src/design.js` (`runDesign`, `waitForGeneration`, `selectGenerated`,
  `handoffCommand`, INPAGE helpers) and `src/cli.js` (`parseArgs`, `runCommand`, `printHelp`) — the
  recently-added `--project` plumbing is the pattern to mirror.
- No external research warranted — internal CLI behavior plus the recon above.
