import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("bubble liquid fill reverted", () => {
  it("drops droplet-fill markup and progress wiring from BubbleMap", () => {
    const src = readFileSync(join(root, "components/BubbleMap.tsx"), "utf8");
    assert.doesNotMatch(src, /droplet-fill/);
    assert.doesNotMatch(src, /bubbleFill/);
    assert.doesNotMatch(src, /--fill-pct/);
    assert.doesNotMatch(src, /workProgress/);
  });

  it("drops liquid-fill CSS from index.css", () => {
    const css = readFileSync(join(root, "index.css"), "utf8");
    assert.doesNotMatch(css, /\.droplet-fill/);
    assert.doesNotMatch(css, /--fill-pct/);
  });
});
