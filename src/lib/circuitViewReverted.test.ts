import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("circuit view reverted", () => {
  it("removes circuit from ViewMode and app wiring", () => {
    const types = readFileSync(join(root, "types.ts"), "utf8");
    assert.doesNotMatch(types, /"circuit"/);
    const app = readFileSync(join(root, "App.tsx"), "utf8");
    assert.doesNotMatch(app, /CircuitView/);
  });

  it("drops circuit-specific CSS from index.css", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    assert.doesNotMatch(css, /view-circuit/);
    assert.doesNotMatch(css, /\.circuit-/);
  });
});
