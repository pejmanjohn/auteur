import { test } from "node:test";
import assert from "node:assert/strict";
import { variationsInstruction, VARIATIONS_MAX } from "../src/design.js";

test("n=3 augments with the count, references Tweaks, and keeps one design", () => {
  const s = variationsInstruction(3);
  assert.match(s, /3 distinct variations/);
  assert.match(s, /tweaks panel/i);
  assert.match(s, /one design/i);
});

test("n=2 is the minimum that augments", () => {
  const s = variationsInstruction(2);
  assert.notEqual(s, "");
  assert.match(s, /2 distinct variations/);
});

test("n < 2 returns empty (no augmentation — default path)", () => {
  assert.equal(variationsInstruction(1), "");
  assert.equal(variationsInstruction(0), "");
  assert.equal(variationsInstruction(undefined), "");
});

test("n above the max clamps to VARIATIONS_MAX", () => {
  const s = variationsInstruction(99);
  assert.match(s, new RegExp(`${VARIATIONS_MAX} distinct variations`));
  assert.doesNotMatch(s, /99/);
});

test("non-integer / NaN / null are treated as no variations (no throw)", () => {
  assert.equal(variationsInstruction("abc"), "");
  assert.equal(variationsInstruction(NaN), "");
  assert.equal(variationsInstruction(null), "");
});

test("fractional n floors toward the lower count", () => {
  assert.match(variationsInstruction(2.9), /2 distinct variations/);
});
