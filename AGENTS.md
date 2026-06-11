# auteur — notes for agents working on this repo

auteur is an oracle-style CLI that drives a signed-in Chrome (via the DevTools
Protocol) to run a design prompt through claude.ai/design and return a
"Send to Claude Code" handoff. Zero API keys — it uses the browser's own session.

## Layout

- `bin/auteur.js` — CLI entry (shebang).
- `src/cli.js` — arg parsing, commands (`run` default, `login`, `doctor`, `stop`), output.
- `src/cdp.js` — Chrome lifecycle over CDP: launch/attach/stop, dedicated profile,
  page-eval + keyboard-input helpers.
- `src/design.js` — Claude Design ("Omelette") orchestration. `INPAGE` is a string
  of page-context helpers (`window.__auteur`) used identically whether evaluated
  over CDP or pasted into DevTools. `runDesign()` is the full create→send→wait→
  collect→handoff flow.

## How the integration works (reverse-engineered)

claude.ai/design speaks Connect-RPC at
`/design/anthropic.omelette.api.v1alpha.OmeletteService/<Method>` (JSON, cookie auth):

- `CreateProject {name}` → `{projectId}`
- `ListFiles {projectId}` → `{entries:[{name,path,type,size,version,...}]}` (a shared
  `support.js` runtime file is filtered out)
- `GetFile {projectId,path}` → `{content:<base64>}`
- `MintHandoffToken {projectId, includeChats:true}` → `{token}`; handoff URL is
  `https://api.anthropic.com/v1/design/h/<token>?open_file=<file>`

The prompt is sent through the **DOM composer** (a ProseMirror contenteditable),
not the protobuf `SendMultiplayerMessage` RPC, so Claude builds the full message
(attachments/options) itself. Generation is "busy" while an `<i class="ai-Stop">`
icon is visible; done when it disappears and the design file list is stable.

## Conventions

- Plain Node ESM, no build step, minimal deps (`chrome-launcher`, `chrome-remote-interface`).
- Chrome stays running between commands (faster + keeps the session warm); `--quit`
  or `auteur stop` closes it gracefully (graceful close flushes cookies to disk).
- Keep `runDesign` resilient to DOM churn: prefer the page's own RPC for data,
  the DOM only for the irreducible "type + click send" step.
