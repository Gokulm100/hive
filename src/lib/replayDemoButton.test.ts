import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showReplayDemoButton } from "./replayDemoButton.js";

describe("showReplayDemoButton", () => {
  it("hides replay until the user picks Demo", () => {
    assert.equal(showReplayDemoButton("demo", false), false);
    assert.equal(showReplayDemoButton("live", false), false);
  });

  it("shows replay in demo after the user picked Demo", () => {
    assert.equal(showReplayDemoButton("demo", true), true);
  });

  it("hides replay in live even after the user had picked Demo", () => {
    assert.equal(showReplayDemoButton("live", true), false);
  });
});
