// Claude Design ("Omelette") orchestration.
//
// Everything here ultimately runs as `fetch`/DOM calls *inside* a signed-in
// claude.ai/design page. The CLI drives it over CDP; the same INPAGE helpers can
// be pasted into any page console to reproduce a run by hand. We deliberately use
// the page's own authenticated session instead of re-implementing Anthropic auth.

const RPC_BASE = "/design/anthropic.omelette.api.v1alpha.OmeletteService";
export const DESIGN_URL = "https://claude.ai/design";
export const HANDOFF_API_BASE = "https://api.anthropic.com/v1/design";

// Files Claude Design writes as shared scaffolding rather than "the design".
const RUNTIME_FILES = new Set(["support.js"]);

/**
 * Source for `window.__auteur`, a set of page-context helpers. Injected once per
 * page; safe to re-inject. Kept as a plain string so it works identically whether
 * evaluated via CDP `Runtime.evaluate` or pasted into DevTools.
 */
export const INPAGE = String.raw`
window.__auteur = (() => {
  const BASE = ${JSON.stringify(RPC_BASE)};
  async function rpc(method, body) {
    const r = await fetch(BASE + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text };
  }
  const RUNTIME = new Set(${JSON.stringify([...RUNTIME_FILES])});
  function b64decode(b64) {
    const bin = atob(b64);
    try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
  }
  function promptBox() {
    return document.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"]'
    );
  }
  function findButton(re) {
    return [...document.querySelectorAll('button')].find((b) =>
      re.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || ''))
    );
  }
  return {
    async listProjects() { return rpc('ListProjects', {}); },
    async authed() {
      const r = await rpc('ListProjects', {});
      return r.status === 200;
    },
    async createProject(name) {
      const r = await rpc('CreateProject', { name: name || 'auteur' });
      if (r.status !== 200 || !r.json || !r.json.projectId)
        throw new Error('CreateProject failed: ' + r.status + ' ' + r.text.slice(0, 200));
      return r.json.projectId;
    },
    async listFiles(projectId) {
      const r = await rpc('ListFiles', { projectId });
      return (r.json && r.json.entries) || [];
    },
    designFiles(entries) {
      return entries.filter(
        (e) => e.type === 'file' && !RUNTIME.has(e.name) && !e.name.endsWith('.js')
      );
    },
    async getFile(projectId, path) {
      const r = await rpc('GetFile', { projectId, path });
      if (!r.json || r.json.content == null)
        throw new Error('GetFile failed for ' + path + ': ' + r.status);
      return b64decode(r.json.content);
    },
    async mintHandoff(projectId) {
      const r = await rpc('MintHandoffToken', { projectId, includeChats: true });
      if (!r.json || !r.json.token)
        throw new Error('MintHandoffToken failed: ' + r.status + ' ' + r.text.slice(0, 200));
      return r.json.token;
    },
    isGenerating() {
      // While a turn runs the composer's send icon (ai-PaperPlane) is swapped
      // for a stop icon (ai-Stop). That swap is the reliable busy signal — the
      // button itself carries no text/aria-label.
      const i = document.querySelector('i.ai-Stop');
      return !!(i && i.offsetParent !== null);
    },
    turnComplete() {
      // Sometimes-present extra signal; not all turns render feedback controls.
      return !!findButton(/good response|bad response/i);
    },
    composerText() {
      const el = promptBox();
      return el ? (el.value || el.innerText || '').trim() : '';
    },
    focusComposer() {
      const el = promptBox();
      if (!el) return false;
      el.focus();
      return true;
    },
    clickSend() {
      // The send control is an icon button (ai-PaperPlane) with no label/text.
      const icon = document.querySelector('i.ai-PaperPlane');
      const btn = icon ? icon.closest('button') : findButton(/^\s*send/i);
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    },
  };
})();
true;
`;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ensure the INPAGE helpers are present on the page. */
export async function inject(page) {
  await page.eval(`${INPAGE} return true;`);
}

/** Build the handoff command an agent receives, mirroring the in-app modal text. */
export function handoffCommand({ token, openFile }) {
  const params = openFile ? `?open_file=${encodeURIComponent(openFile)}` : "";
  const url = `${HANDOFF_API_BASE}/h/${token}${params}`;
  const scope = openFile || "the designs in this project";
  const command =
    `Fetch this design file, read its readme, and implement the relevant aspects of the design. ${url}\n` +
    `Implement: ${scope}`;
  return { url, command, scope };
}

/**
 * Full run: create a project, send the prompt, wait for generation, collect the
 * generated files, and mint a handoff. `page` is a CDP Page (see src/cdp.js).
 * `send` performs the keyboard send (CDP Input); injectable for testing.
 */
export async function runDesign(page, { prompt, projectName, maxWaitMs = 240000, onStatus = () => {} } = {}) {
  if (!prompt || !prompt.trim()) throw new Error("A design prompt is required.");
  onStatus("Opening Claude Design…");
  await page.navigate(DESIGN_URL, { waitMs: 2500 });
  await inject(page);

  const authed = await page.eval(`return await window.__auteur.authed();`);
  if (!authed) {
    throw new Error(
      "Not signed in to claude.ai in auteur's Chrome profile. Run `auteur login` first.",
    );
  }

  onStatus("Creating project…");
  const projectId = await page.eval(
    `return await window.__auteur.createProject(${JSON.stringify(projectName || `auteur ${nowStamp()}`)});`,
  );

  onStatus("Loading project workspace…");
  await page.navigate(`${DESIGN_URL}/p/${projectId}`, { waitMs: 2500 });
  await inject(page);
  await waitFor(page, `return window.__auteur.focusComposer();`, 20000, 500);

  onStatus("Sending prompt…");
  await page.eval(`window.__auteur.focusComposer(); return true;`);
  await sleep(250);
  // Type as real keyboard input so the ProseMirror composer registers it, then
  // click the send icon (Enter can insert a newline instead of submitting).
  await page.insertText(prompt);
  await sleep(400);
  const typed = await page.eval(`return window.__auteur.composerText().length;`);
  if (!typed) throw new Error("Could not enter the prompt into the composer.");
  let clicked = await page.eval(`return window.__auteur.clickSend();`);
  await sleep(800);
  if (await page.eval(`return window.__auteur.composerText().length;`)) {
    // Composer still holds text — try Enter as a fallback, then click again.
    await page.pressEnter();
    await sleep(600);
    if (await page.eval(`return window.__auteur.composerText().length;`)) {
      await page.eval(`return window.__auteur.clickSend();`);
    }
  }

  onStatus("Claude Design is generating…");
  const files = await waitForGeneration(page, projectId, { maxWaitMs, onStatus });

  onStatus("Reading generated files…");
  const collected = [];
  for (const f of files) {
    const content = await retry(() =>
      page.eval(`return await window.__auteur.getFile(${JSON.stringify(projectId)}, ${JSON.stringify(f.path)});`),
    );
    collected.push({ ...f, content });
  }

  onStatus("Minting handoff…");
  const token = await retry(() =>
    page.eval(`return await window.__auteur.mintHandoff(${JSON.stringify(projectId)});`),
  );
  const openFile = primaryFile(files)?.path;
  const handoff = handoffCommand({ token, openFile });

  return {
    projectId,
    projectUrl: `${DESIGN_URL}/p/${projectId}`,
    files: collected,
    primaryFile: openFile,
    handoff,
  };
}

/**
 * Poll until generation finishes and design files are stable.
 *
 * A design file appears *during* streaming and Claude keeps the busy state for a
 * while after the file settles (and occasionally the stop icon lingers past the
 * visible end). So "done" means: at least one design file whose signature has
 * held steady — either with the busy state cleared, or steady long enough that a
 * lingering busy state no longer matters. Per-tick errors are tolerated.
 */
export async function waitForGeneration(page, projectId, { maxWaitMs = 240000, onStatus = () => {} } = {}) {
  const start = Date.now();
  const pid = JSON.stringify(projectId);
  let sawGenerating = false;
  let lastSig = null;
  let stableSince = Date.now();
  let last = { count: 0, generating: false };

  while (Date.now() - start < maxWaitMs) {
    await sleep(2000);
    let state;
    try {
      state = await page.eval(`
        const entries = await window.__auteur.listFiles(${pid});
        const design = window.__auteur.designFiles(entries);
        return {
          generating: window.__auteur.isGenerating(),
          complete: window.__auteur.turnComplete(),
          sig: design.map(d => d.name + ':' + (d.version||d.size||'')).sort().join('|'),
          count: design.length,
        };
      `);
    } catch (err) {
      // Transient CDP/eval stall — try again next tick instead of dying.
      continue;
    }
    last = state;
    if (state.generating) sawGenerating = true;
    const now = Date.now();
    if (state.sig !== lastSig) {
      lastSig = state.sig;
      stableSince = now;
    }
    const stableMs = now - stableSince;
    const elapsed = Math.round((now - start) / 1000);
    onStatus(`Claude Design is generating… (${elapsed}s, ${state.count} file${state.count === 1 ? "" : "s"})`);

    if (state.count > 0) {
      const settledQuiet = !state.generating && stableMs >= 2500 && (sawGenerating || elapsed > 10);
      const settledHard = stableMs >= 18000; // busy state lingered — accept the stable file
      if (settledQuiet || settledHard) break;
    }
  }

  let design = [];
  try {
    design = await page.eval(`return window.__auteur.designFiles(await window.__auteur.listFiles(${pid}));`);
  } catch {}
  if (!design.length) {
    throw new Error(
      `Timed out after ${Math.round(maxWaitMs / 1000)}s without a generated design file (last saw ${last.count} design file(s)).`,
    );
  }
  return design;
}

function primaryFile(files) {
  // The most-recently-updated HTML file is what the user is looking at.
  const html = files.filter((f) => /\.html$/i.test(f.name));
  const pool = html.length ? html : files;
  return [...pool].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
}

async function waitFor(page, body, timeoutMs, intervalMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.eval(body)) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function retry(fn, { attempts = 3, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr;
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
