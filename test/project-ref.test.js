import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectRef } from "../src/design.js";

test("URL with ?file= resolves to id", () => {
  const r = parseProjectRef(
    "https://claude.ai/design/p/019de1b4-3f12-767d-b78e-4491ec91d5e2?file=Skillet.html",
  );
  assert.deepEqual(r, { kind: "id", projectId: "019de1b4-3f12-767d-b78e-4491ec91d5e2" });
});

test("URL with a trailing hash resolves to id", () => {
  const r = parseProjectRef(
    "https://claude.ai/design/p/019de1b4-3f12-767d-b78e-4491ec91d5e2#section",
  );
  assert.equal(r.kind, "id");
  assert.equal(r.projectId, "019de1b4-3f12-767d-b78e-4491ec91d5e2");
});

test("bare UUID (mixed case) is normalized to a lowercase id", () => {
  const r = parseProjectRef("019DE1B4-3F12-767D-B78E-4491EC91D5E2");
  assert.deepEqual(r, { kind: "id", projectId: "019de1b4-3f12-767d-b78e-4491ec91d5e2" });
});

test("a plain name is treated as a name", () => {
  assert.deepEqual(parseProjectRef("Skillet"), { kind: "name", name: "Skillet" });
});

test("a name that merely contains hex but is not a UUID stays a name", () => {
  assert.deepEqual(parseProjectRef("Design abc123"), { kind: "name", name: "Design abc123" });
});

test("surrounding whitespace is trimmed", () => {
  assert.deepEqual(parseProjectRef("  Skillet  "), { kind: "name", name: "Skillet" });
});

test("empty or whitespace-only input throws", () => {
  assert.throws(() => parseProjectRef("   "));
  assert.throws(() => parseProjectRef(""));
});
