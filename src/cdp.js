// Chrome control over the DevTools Protocol.
//
// auteur talks to claude.ai/design through a real, signed-in Chrome — exactly
// the way oracle talks to chatgpt.com. We never reimplement Anthropic auth; the
// browser already holds the cookies, so we just drive its page context.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import CDP from "chrome-remote-interface";
import { Launcher, launch } from "chrome-launcher";

export const AUTEUR_HOME = process.env.AUTEUR_HOME || join(homedir(), ".auteur");
export const PROFILE_DIR = join(AUTEUR_HOME, "chrome-profile");
export const DEFAULT_PORT = Number(process.env.AUTEUR_CDP_PORT || 9322);

const CHROME_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-features=Translate,MediaRouter,OptimizationHints",
  "--disable-popup-blocking",
  "--hide-crash-restore-bubble",
];

function chromePath() {
  if (process.env.AUTEUR_CHROME_PATH) return process.env.AUTEUR_CHROME_PATH;
  try {
    const installs = Launcher.getInstallations();
    if (installs && installs.length) return installs[0];
  } catch {}
  return undefined;
}

/**
 * Launch (or reuse) auteur's dedicated Chrome profile with a DevTools port open.
 * The profile persists between runs, so the user logs into claude.ai exactly once.
 */
export async function launchChrome({ port = DEFAULT_PORT, headless = false } = {}) {
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const flags = [...CHROME_FLAGS];
  if (headless) flags.push("--headless=new");
  const chrome = await launch({
    port,
    chromePath: chromePath(),
    userDataDir: PROFILE_DIR,
    ignoreDefaultFlags: true,
    chromeFlags: flags,
  });
  return {
    port: chrome.port,
    kill: async () => {
      try {
        await chrome.kill();
      } catch {}
    },
  };
}

/** Is an auteur Chrome already listening on this DevTools port? */
export async function chromeUp({ port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  try {
    await CDP.List({ port, host });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the running Chrome via the CDP Browser domain. A clean close
 * flushes cookies to disk, so the claude.ai session survives the shutdown.
 */
export async function stopChrome({ port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  let browser;
  try {
    browser = await CDP({ port, host });
    await browser.Browser.close();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}

/** Attach to a page target on an already-running Chrome, creating one if needed. */
export async function attachPage({ port = DEFAULT_PORT, host = "127.0.0.1", url } = {}) {
  let targets = [];
  try {
    targets = await CDP.List({ port, host });
  } catch (err) {
    throw new Error(
      `Could not reach Chrome DevTools on ${host}:${port} (${err.message}). ` +
        `Run \`auteur login\` first, or pass --port.`,
    );
  }
  let target = targets.find((t) => t.type === "page" && /claude\.ai\/design/.test(t.url));
  if (!target) {
    target = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  }
  if (!target) {
    target = await CDP.New({ port, host, url: url || "about:blank" });
  }
  const client = await CDP({ port, host, target: target.webSocketDebuggerUrl || target.id });
  await client.Page.enable();
  await client.Runtime.enable();
  await client.DOM.enable();
  return new Page(client, { port, host });
}

/** Thin convenience wrapper around a CDP page client. */
export class Page {
  constructor(client, conn) {
    this.client = client;
    this.conn = conn;
  }

  async navigate(url, { waitMs = 1500 } = {}) {
    await withTimeout(this.client.Page.navigate({ url }), 20000, "Page.navigate");
    try {
      await Promise.race([
        this.client.Page.loadEventFired(),
        new Promise((r) => setTimeout(r, 15000)),
      ]);
    } catch {}
    await sleep(waitMs);
  }

  get url() {
    return this.client.Runtime.evaluate({ expression: "location.href", returnByValue: true })
      .then((r) => r.result.value)
      .catch(() => "");
  }

  /**
   * Evaluate an async function body in the page and return its JSON value.
   * `body` is the source of an async function (may use `await`, `return`).
   */
  async eval(body, { timeoutMs = 25000 } = {}) {
    const expression = `(async () => { ${body} })()`;
    // A hung CDP call (e.g. an in-page fetch that never settles) must not freeze
    // the caller — time it out so polling loops can recover on the next tick.
    const { result, exceptionDetails } = await withTimeout(
      this.client.Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true }),
      timeoutMs,
      "Runtime.evaluate",
    );
    if (exceptionDetails) {
      const msg =
        exceptionDetails.exception?.description ||
        exceptionDetails.text ||
        "page evaluation failed";
      throw new Error(msg);
    }
    return result.value;
  }

  /** Type text into the currently focused element as real keyboard input. */
  async insertText(text) {
    await this.client.Input.insertText({ text });
  }

  async pressEnter() {
    const base = { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r" };
    await this.client.Input.dispatchKeyEvent({ type: "keyDown", ...base });
    await this.client.Input.dispatchKeyEvent({ type: "keyUp", ...base });
  }

  async close() {
    try {
      await this.client.close();
    } catch {}
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Reject if a promise (e.g. a CDP command) doesn't settle in time. */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
