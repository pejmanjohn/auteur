// auteur CLI — whisper a design prompt to claude.ai/design and bring the
// generated design (plus a ready-to-run handoff) back to your coding agent.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChrome, attachPage, chromeUp, stopChrome, PROFILE_DIR, DEFAULT_PORT, sleep } from "./cdp.js";
import { runDesign, DESIGN_URL, inject } from "./design.js";
import { installSkill, uninstallSkill, skillStatus } from "./skill.js";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  orange: (s) => `\x1b[38;5;209m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function printHelp() {
  const o = C.orange;
  console.log(`
${o("auteur")} ${C.dim("v" + pkg.version)} — ${C.dim("whisper a design prompt to Claude Design, bring the result back to your agent")}

${C.bold("USAGE")}
  auteur ${C.dim('"<design prompt>"')}            Generate a design and print a handoff for your agent
  auteur -p ${C.dim('"<prompt>"')} [options]
  auteur login                       One-time: sign in to claude.ai in auteur's browser profile
  auteur doctor                      Check Chrome + claude.ai sign-in status
  auteur stop                        Close auteur's background Chrome
  auteur skill install               Add the /auteur skill to Claude Code & Codex
  auteur skill                       Show where the /auteur skill is installed

${C.bold("OPTIONS")}
  -p, --prompt <text>    The design prompt (or pass it positionally, or via stdin)
  -o, --out <dir>        Write generated design files to <dir>
      --name <name>      Name for the Claude Design project
      --port <n>         Chrome DevTools port (default ${DEFAULT_PORT})
      --headless         Run Chrome headless when launching (default: visible)
      --quit             Close Chrome when done (default: keep it running for fast reuse)
      --timeout <sec>    Max seconds to wait for generation (default 240)
      --json             Emit machine-readable JSON instead of prose
  -h, --help             Show this help
  -v, --version          Show version

${C.bold("EXAMPLES")}
  ${C.dim("# First run — sign in once (a Chrome window opens):")}
  auteur login

  ${C.dim("# Generate a design and hand it to your agent:")}
  auteur "A pricing page for a SaaS app, three tiers, light theme"

  ${C.dim("# Save the files locally too:")}
  auteur -p "Dashboard empty state" --out ./designs

${C.dim("auteur drives a dedicated Chrome profile (" + PROFILE_DIR + ") just like")}
${C.dim("oracle drives ChatGPT — your normal browser and logins are untouched.")}
`);
}

function parseArgs(argv) {
  const opts = { _: [], port: DEFAULT_PORT, timeout: 240, headless: false, keep: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-h": case "--help": opts.help = true; break;
      case "-v": case "--version": opts.version = true; break;
      case "-p": case "--prompt": opts.prompt = next(); break;
      case "-o": case "--out": opts.out = next(); break;
      case "--name": opts.name = next(); break;
      case "--port": opts.port = Number(next()); break;
      case "--timeout": opts.timeout = Number(next()); break;
      case "--headless": opts.headless = true; break;
      case "--quit": opts.quit = true; break;
      case "--json": opts.json = true; break;
      case "--claude": opts.claude = true; break;
      case "--codex": opts.codex = true; break;
      case "--copy": opts.copy = true; break;
      case "--force": opts.force = true; break;
      default:
        if (a.startsWith("-")) { console.error(C.red(`Unknown option: ${a}`)); process.exit(2); }
        opts._.push(a);
    }
  }
  return opts;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.version) return void console.log(pkg.version);
  if (opts.help) return void printHelp();

  const command = opts._[0];
  if (command === "login") return loginCommand(opts);
  if (command === "doctor") return doctorCommand(opts);
  if (command === "stop" || command === "quit") return stopCommand(opts);
  if (command === "skill") return skillCommand(opts);

  // Default command: run a design.
  let prompt = opts.prompt || (command === "run" ? opts._.slice(1).join(" ") : opts._.join(" "));
  if (!prompt) prompt = await readStdin();
  if (!prompt || !prompt.trim()) {
    printHelp();
    process.exit(opts._.length ? 0 : 1);
  }
  return runCommand(prompt.trim(), opts);
}

function status(msg) {
  process.stderr.write(`${C.dim("›")} ${msg}\n`);
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * Get a page in auteur's dedicated Chrome. Reuses a Chrome already running on
 * the port (keeping the live claude.ai session warm); otherwise launches one and
 * leaves it running for the next command — just like oracle keeps its browser
 * around. Pass `--quit` to shut Chrome down (gracefully, so cookies persist).
 */
async function acquirePage(opts) {
  if (await chromeUp({ port: opts.port })) {
    status(`Attaching to Chrome on port ${opts.port}`);
    return { page: await attachPage({ port: opts.port }), launched: false };
  }
  status(`Launching Chrome ${C.dim("(" + PROFILE_DIR + ")")}`);
  const chrome = await launchChrome({ port: opts.port, headless: opts.headless });
  await sleep(900);
  return { page: await attachPage({ port: chrome.port }), launched: true };
}

async function withChrome(opts, fn) {
  const { page } = await acquirePage(opts);
  try {
    return await fn(page);
  } finally {
    if (opts.quit) {
      await stopChrome({ port: opts.port });
      status("Closed auteur's Chrome (--quit).");
    }
  }
}

async function runCommand(prompt, opts) {
  const result = await withChrome(opts, async (page) => {
    return runDesign(page, {
      prompt,
      projectName: opts.name,
      maxWaitMs: opts.timeout * 1000,
      onStatus: status,
    });
  });

  // Persist files if requested.
  let writtenPaths = [];
  if (opts.out) {
    const dir = resolve(opts.out);
    mkdirSync(dir, { recursive: true });
    for (const f of result.files) {
      const p = join(dir, f.name);
      writeFileSync(p, f.content);
      writtenPaths.push(p);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({
      projectId: result.projectId,
      projectUrl: result.projectUrl,
      primaryFile: result.primaryFile,
      files: result.files.map((f) => ({ name: f.name, path: f.path, bytes: f.content.length })),
      writtenPaths,
      handoff: result.handoff,
    }, null, 2));
    return;
  }

  // Human output. The handoff command is the payload the agent acts on.
  const o = C.orange;
  console.log("");
  console.log(o("  ✦ Claude Design is done."));
  console.log("");
  console.log(`  ${C.bold("Project")}   ${result.projectUrl}`);
  console.log(`  ${C.bold("Files")}     ${result.files.map((f) => `${f.name} ${C.dim("(" + humanBytes(f.content.length) + ")")}`).join("\n            ")}`);
  if (writtenPaths.length) {
    console.log(`  ${C.bold("Saved")}     ${writtenPaths.join("\n            ")}`);
  }
  console.log("");
  console.log(C.dim("  ── Hand this to your coding agent ") + C.dim("─".repeat(40)));
  console.log("");
  console.log(C.cyan(result.handoff.command.split("\n").map((l) => "  " + l).join("\n")));
  console.log("");
}

async function loginCommand(opts) {
  // Reuse a running Chrome if present, else launch one — and leave it running so
  // the freshly-signed-in session stays live for the first design run.
  const { page } = await acquirePage(opts);
  await page.navigate(DESIGN_URL, { waitMs: 2000 });
  await inject(page).catch(() => {});
  const alreadyIn = await page
    .eval(`const r = await fetch('/design/anthropic.omelette.api.v1alpha.OmeletteService/ListProjects',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); return r.status===200;`)
    .catch(() => false);
  if (alreadyIn) {
    console.log(C.green("\n  ✓ Already signed in. auteur is ready.\n"));
    return;
  }
  console.log(C.orange("\n  Sign in to Claude in the Chrome window that just opened.\n"));
  status("Waiting for sign-in… (Ctrl-C to cancel)");
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const ok = await page
      .eval(`const r = await fetch('/design/anthropic.omelette.api.v1alpha.OmeletteService/ListProjects',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); return r.status===200;`)
      .catch(() => false);
    if (ok) {
      console.log(C.green("\n  ✓ Signed in. auteur is ready — try:  ") + C.bold('auteur "a hero section for a coffee brand"') + "\n");
      return; // Leave Chrome running; the next command attaches to this session.
    }
  }
  console.log(C.red("\n  Timed out waiting for sign-in. Run `auteur login` again.\n"));
  process.exitCode = 1;
}

async function stopCommand(opts) {
  if (!(await chromeUp({ port: opts.port }))) {
    console.log(C.dim("auteur's Chrome isn't running."));
    return;
  }
  await stopChrome({ port: opts.port });
  console.log(C.green("Closed auteur's Chrome."));
}

function skillCommand(opts) {
  const sub = opts._[1] || "status";
  if (sub === "install") {
    const results = installSkill(opts);
    for (const r of results) {
      if (r.action === "skipped") console.log(`  ${C.dim("–")} ${r.target.label}: ${C.dim(r.reason)}`);
      else console.log(`  ${C.green("✓")} ${r.target.label}: ${r.action} ${C.dim("→ " + r.target.dir)}`);
    }
    console.log(C.dim("\n  Open a new session and type ") + C.bold("/auteur") + C.dim(" to use it."));
    return;
  }
  if (sub === "uninstall" || sub === "remove") {
    for (const r of uninstallSkill(opts)) {
      const mark = r.action === "removed" ? C.green("✓") : C.dim("–");
      console.log(`  ${mark} ${r.target.label}: ${r.action}`);
    }
    return;
  }
  // status (default)
  console.log(C.bold("auteur skill\n"));
  const statuses = skillStatus();
  for (const s of statuses) {
    const label = s.target.label.padEnd(12);
    const map = { linked: C.green("linked ✓"), "linked-other": C.red("links elsewhere"), copied: C.green("copied ✓"), absent: C.dim("not installed"), unknown: C.dim("?") };
    console.log(`  ${label}${map[s.state] || s.state}  ${C.dim(s.target.dir)}`);
  }
  const allInstalled = statuses.every((s) => s.state === "linked" || s.state === "copied");
  if (allInstalled) {
    console.log(C.dim("\n  Type ") + C.bold("/auteur") + C.dim(" in a new session. Remove with ") + C.bold("auteur skill uninstall") + C.dim("."));
  } else {
    console.log(C.dim("\n  Install with ") + C.bold("auteur skill install") + C.dim("  (use --claude or --codex to pick one, --copy to copy instead of symlink)."));
  }
}

async function doctorCommand(opts) {
  console.log(C.bold("auteur doctor\n"));
  console.log(`  profile     ${PROFILE_DIR}`);
  try {
    const running = await chromeUp({ port: opts.port });
    const { page } = await acquirePage(opts);
    console.log(`  chrome      ${C.green(running ? "running" : "launched")} on port ${opts.port}`);
    await page.navigate(DESIGN_URL, { waitMs: 2000 });
    const status200 = await page
      .eval(`const r = await fetch('/design/anthropic.omelette.api.v1alpha.OmeletteService/ListProjects',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); return r.status;`)
      .catch((e) => String(e));
    if (status200 === 200) console.log(`  claude.ai   ${C.green("signed in")} ✓`);
    else console.log(`  claude.ai   ${C.red("not signed in")} (status ${status200}) — run ${C.bold("auteur login")}`);
  } catch (e) {
    console.log(`  chrome      ${C.red("failed")}: ${e.message}`);
    process.exitCode = 1;
  }
}
