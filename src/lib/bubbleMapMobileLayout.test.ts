import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BUBBLE_MAP_MOBILE_CANVAS_MIN_HEIGHT,
  BUBBLE_MAP_MOBILE_MIN_HEIGHT,
} from "./bubbleMapMobileLayout.js";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../index.css");
const css = readFileSync(cssPath, "utf8");

function expectMinHeight(block: string, selector: string, px: number) {
  const re = new RegExp(
    `${selector.replace(/\./g, "\\.")}[\\s\\S]*?min-height:\\s*(${px})px`
  );
  assert.match(
    block,
    re,
    `expected ${selector} min-height: ${px}px in block`
  );
}

describe("bubble map mobile layout CSS", () => {
  it("reserves enough map-shell height on tablet-width bubbles view", () => {
    const start = css.indexOf("@media (max-width: 860px)");
    assert.ok(start >= 0);
    const end = css.indexOf("@media", start + 10);
    const block = css.slice(start, end > start ? end : start + 4000);
    expectMinHeight(
      block,
      "body.view-bubbles .map-shell",
      BUBBLE_MAP_MOBILE_MIN_HEIGHT.tablet
    );
    expectMinHeight(
      block,
      "body.view-circuit .map-shell",
      BUBBLE_MAP_MOBILE_MIN_HEIGHT.tablet
    );
    assert.match(
      block,
      /body\.view-bubbles \.map-shell[\s\S]*?height:\s*min\(72dvh,\s*680px\)/,
      "tablet map-shell viewport height"
    );
  });

  it("reserves canvas area when toolbars sit above the bubble map", () => {
    const start = css.indexOf("@media (max-width: 860px)");
    const end = css.indexOf("@media", start + 10);
    const block = css.slice(start, end > start ? end : start + 4000);
    expectMinHeight(
      block,
      "body.view-bubbles .map-shell .map-canvas-wrap",
      BUBBLE_MAP_MOBILE_CANVAS_MIN_HEIGHT
    );
  });

  it("does not shrink map-shell too far on short phones", () => {
    const marker = "@media (max-width: 860px) and (max-height: 700px)";
    const start = css.indexOf(marker);
    assert.ok(start >= 0, marker);
    const end = css.indexOf("@media", start + marker.length);
    const block = css.slice(start, end > start ? end : start + 800);
    expectMinHeight(
      block,
      "body.view-bubbles .map-shell",
      BUBBLE_MAP_MOBILE_MIN_HEIGHT.short
    );
    expectMinHeight(
      block,
      "body.view-circuit .map-shell",
      BUBBLE_MAP_MOBILE_MIN_HEIGHT.short
    );
  });

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

  it("keeps a tall enough map on narrow phones", () => {
    const needle = `min-height: ${BUBBLE_MAP_MOBILE_MIN_HEIGHT.phone}px`;
    const rule = `body.view-bubbles .map-shell`;
    const marker = "@media (max-width: 520px)";
    const start = css.lastIndexOf(marker);
    assert.ok(start >= 0);
    const tail = css.slice(start);
    const ruleIdx = tail.indexOf(rule);
    assert.ok(ruleIdx >= 0, rule);
    const afterRule = tail.slice(ruleIdx, ruleIdx + 400);
    assert.match(
      afterRule,
      new RegExp(`min-height:\\s*${BUBBLE_MAP_MOBILE_MIN_HEIGHT.phone}px`),
      needle
    );
    assert.match(
      afterRule,
      /height:\s*min\(70dvh,\s*640px\)/,
      "phone map-shell viewport height"
    );
  });
});
