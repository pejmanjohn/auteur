// Install the auteur skill into coding-agent CLIs so users can type `/auteur`.
//
// One SKILL.md serves both Claude Code (~/.claude/skills/auteur) and Codex
// (~/.codex/skills/auteur) — both read the same `name`/`description` frontmatter
// and Markdown body. We symlink by default so the installed skill tracks the repo
// (or the globally-installed package) and updates with it.

import { existsSync, mkdirSync, lstatSync, rmSync, symlinkSync, cpSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Where the canonical skill lives inside this package/repo.
export const SKILL_SRC = fileURLToPath(new URL("../skills/auteur", import.meta.url));

// Each agent CLI: a friendly label and its skills directory.
export const TARGETS = [
  { id: "claude", label: "Claude Code", dir: join(homedir(), ".claude", "skills", "auteur"), parent: join(homedir(), ".claude") },
  { id: "codex", label: "Codex", dir: join(homedir(), ".codex", "skills", "auteur"), parent: join(homedir(), ".codex") },
];

function selectedTargets(opts) {
  const picked = TARGETS.filter((t) => opts[t.id]);
  return picked.length ? picked : TARGETS; // default: all
}

function describe(target) {
  if (!existsSync(target.dir)) return { state: "absent" };
  try {
    const st = lstatSync(target.dir);
    if (st.isSymbolicLink()) {
      const dest = realpathSync(target.dir);
      return { state: dest === realpathSync(SKILL_SRC) ? "linked" : "linked-other", dest };
    }
    return { state: "copied" };
  } catch {
    return { state: "unknown" };
  }
}

export function installSkill(opts = {}) {
  const results = [];
  for (const target of selectedTargets(opts)) {
    if (!existsSync(target.parent) && !opts.force) {
      results.push({ target, action: "skipped", reason: `${target.label} not found (${target.parent})` });
      continue;
    }
    mkdirSync(dirname(target.dir), { recursive: true });
    // Replace anything already at the destination so install is idempotent.
    if (existsSync(target.dir) || isDanglingLink(target.dir)) rmSync(target.dir, { recursive: true, force: true });
    if (opts.copy) {
      cpSync(SKILL_SRC, target.dir, { recursive: true });
      results.push({ target, action: "copied" });
    } else {
      symlinkSync(SKILL_SRC, target.dir, "dir");
      results.push({ target, action: "linked" });
    }
  }
  return results;
}

export function uninstallSkill(opts = {}) {
  const results = [];
  for (const target of selectedTargets(opts)) {
    if (existsSync(target.dir) || isDanglingLink(target.dir)) {
      rmSync(target.dir, { recursive: true, force: true });
      results.push({ target, action: "removed" });
    } else {
      results.push({ target, action: "absent" });
    }
  }
  return results;
}

export function skillStatus() {
  return TARGETS.map((target) => ({ target, ...describe(target) }));
}

function isDanglingLink(p) {
  try {
    lstatSync(p); // exists as a link/file even if target is gone
    return true;
  } catch {
    return false;
  }
}
