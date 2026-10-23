import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canWriteCode,
  CODE_WRITER_ROLE_IDS,
  codeRulesForAgent,
  implementClosingLine,
} from "./codeAccess.ts";

describe("canWriteCode", () => {
  it("allows dev and designer only", () => {
    assert.equal(CODE_WRITER_ROLE_IDS.size, 2);
    assert.equal(canWriteCode("dev"), true);
    assert.equal(canWriteCode("designer"), true);
  });

  it("denies qa, merger, researcher, orchestrator, bd", () => {
    for (const id of ["qa", "merger", "researcher", "orchestrator", "bd"]) {
      assert.equal(canWriteCode(id), false, id);
    }
  });
});

describe("codeRulesForAgent", () => {
  it("returns dev test rules for dev", () => {
    assert.match(codeRulesForAgent("dev", "Dev"), /unit tests/i);
  });

  it("returns designer rules for designer", () => {
    assert.match(codeRulesForAgent("designer", "UI Designer"), /UI-related code/i);
  });

  it("returns read-only rules for qa", () => {
    const rules = codeRulesForAgent("qa", "QA");
    assert.match(rules, /Do NOT create, edit/i);
    assert.match(rules, /Only Dev and UI Designer/i);
  });

  it("returns spec-only rules for bd", () => {
    const rules = codeRulesForAgent("bd", "BD");
    assert.match(rules, /markdown specs/i);
    assert.match(rules, /docs\//i);
    assert.doesNotMatch(rules, /UI-related code/i);
  });
});

describe("implementClosingLine", () => {
  it("tells writers to implement in the workspace", () => {
    assert.match(implementClosingLine("dev"), /implement/i);
  });

  it("tells non-writers not to change source code", () => {
    assert.match(implementClosingLine("researcher"), /without changing application source code/i);
  });

  it("lets bd write markdown specs but not code", () => {
    const line = implementClosingLine("bd");
    assert.match(line, /markdown spec/i);
    assert.match(line, /Do not touch application source code/i);
  });
});
