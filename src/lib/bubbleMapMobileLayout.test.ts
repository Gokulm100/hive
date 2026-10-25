import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../index.css");
const css = readFileSync(cssPath, "utf8");

describe("circuit map mobile layout CSS", () => {
  it("allows sideways scroll for circuit map on tablet-width viewports", () => {
    const start = css.indexOf("@media (max-width: 860px)");
    const end = css.indexOf("@media", start + 10);
    const block = css.slice(start, end > start ? end : start + 4000);
    assert.match(
      block,
      /body\.view-circuit \.circuit-canvas-wrap[\s\S]*?overflow-x:\s*auto/,
      "circuit map horizontal scroll on narrow screens"
    );
  });
});
