import { test } from "node:test";
import assert from "node:assert/strict";
import { selectGenerated } from "../src/design.js";

const f = (name, version) => ({ name, version });

test("a new file (name not in baseline) is the generated set", () => {
  const baseline = { "Skillet.html": "v1" };
  const entries = [f("Skillet.html", "v1"), f("Hero.html", "v9")];
  assert.deepEqual(selectGenerated(baseline, entries).map((x) => x.name), ["Hero.html"]);
});

test("a changed file (version bump) is detected as generated", () => {
  const baseline = { "Skillet.html": "v1" };
  const entries = [f("Skillet.html", "v2")];
  assert.deepEqual(selectGenerated(baseline, entries).map((x) => x.name), ["Skillet.html"]);
});

test("an empty baseline returns all files (create-new-project path)", () => {
  const entries = [f("A.html", "1"), f("B.html", "2")];
  assert.deepEqual(selectGenerated({}, entries).map((x) => x.name), ["A.html", "B.html"]);
});

test("baseline equal to current files returns empty (never completes early)", () => {
  const baseline = { "Skillet.html": "v1", "Nav.html": "v3" };
  const entries = [f("Skillet.html", "v1"), f("Nav.html", "v3")];
  assert.deepEqual(selectGenerated(baseline, entries), []);
});

test("a mix of unchanged + new returns only the new file", () => {
  const baseline = { "A.html": "1" };
  const entries = [f("A.html", "1"), f("B.html", "5")];
  assert.deepEqual(selectGenerated(baseline, entries).map((x) => x.name), ["B.html"]);
});

test("null/undefined inputs are handled safely", () => {
  assert.deepEqual(selectGenerated(null, null), []);
  assert.deepEqual(selectGenerated(undefined, [f("A", "1")]).map((x) => x.name), ["A"]);
});
