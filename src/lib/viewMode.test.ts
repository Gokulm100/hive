import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ViewMode } from "../types.js";

describe("ViewMode", () => {
  it("includes circuit as a team map option", () => {
    const modes: ViewMode[] = ["reports", "bubbles", "circuit"];
    assert.equal(modes.length, 3);
    assert.ok(modes.includes("circuit"));
  });
});
