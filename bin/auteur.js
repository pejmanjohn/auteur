#!/usr/bin/env node
import { main } from "../src/cli.js";

// auteur is a one-shot CLI. It leaves its Chrome running on purpose (a detached
// process that survives this exit), but the open DevTools websocket would
// otherwise keep Node's event loop alive — so exit explicitly when done.
main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    process.stderr.write(`\x1b[31mauteur: ${err?.message || err}\x1b[0m\n`);
    process.exit(1);
  });
