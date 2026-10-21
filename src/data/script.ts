import type { ScriptStep } from "../types";
import { DEFAULT_GOAL } from "./cast";
import type { RunMode } from "../api/client";

export function buildScript(
  goal: string,
  mode: RunMode = "build"
): ScriptStep[] {
  const g = goal.trim() || DEFAULT_GOAL;

  if (mode === "brainstorm") {
    return [
      {
        delay: 500,
        type: "orch",
        text: `Brainstorm mode — “${g}”. Lean circle only; guests may pop in.`,
      },
      { delay: 800, type: "agent", id: "manager", status: "working" },
      {
        delay: 1100,
        type: "agent",
        id: "manager",
        status: "done",
        report:
          "Frame it as a discovery session: what wins, what risks, what we skip.",
      },
      { delay: 700, type: "agent", id: "bd", status: "working" },
      {
        delay: 1100,
        type: "agent",
        id: "bd",
        status: "done",
        report:
          "Strong angle: weekly roast drops + origin story. Weak angle: feature laundry lists.",
      },
      {
        delay: 600,
        type: "guest-spawn",
        id: "demo-guest-roast",
        name: "Roast lead",
        role: "Product taste",
        task: "What sensory hooks belong on the hero?",
      },
      {
        delay: 1400,
        type: "guest-done",
        id: "demo-guest-roast",
        name: "Roast lead",
        report:
          "Lead with aroma + origin farm, not SKUs. One photo, one line.",
      },
      {
        delay: 700,
        type: "orch-summary",
        text:
          "Brainstorm takeaway: lead with origin story and weekly drops; keep the circle tight and skip a full feature dump.",
      },
    ];
  }

  return [
    {
      delay: 500,
      type: "orch",
      text: `Got it — “${g}”. Assembling the team and routing work.`,
    },
    { delay: 900, type: "agent", id: "manager", status: "working" },
    {
      delay: 1200,
      type: "agent",
      id: "manager",
      status: "done",
      report:
        "Scoped a 1-page hero → story → CTA flow. Priority: brand warmth over feature lists.",
    },
    { delay: 700, type: "agent", id: "bd", status: "working" },
    {
      delay: 1100,
      type: "agent",
      id: "bd",
      status: "done",
      report:
        "Audience: urban specialty drinkers. Hook: origin story + weekly roast drops. Offer: free shipping on first bag.",
    },
    { delay: 700, type: "agent", id: "designer", status: "working" },
    {
      delay: 1300,
      type: "agent",
      id: "designer",
      status: "done",
      report:
        "Palette: cream, espresso, soft sage. Full-bleed roast photo hero; Fraunces + DM Sans; one primary CTA.",
    },
    { delay: 700, type: "agent", id: "dev", status: "working" },
    {
      delay: 1200,
      type: "agent",
      id: "dev",
      status: "done",
      report:
        "Single-page layout stub ready: hero, three roast cards, subscribe form. Mobile stack verified.",
    },
    { delay: 700, type: "agent", id: "qa", status: "working" },
    {
      delay: 900,
      type: "agent",
      id: "qa",
      status: "blocked",
      report: "CTA contrast fails on cream overlay — waiting on Designer tweak.",
    },
    {
      delay: 1000,
      type: "agent",
      id: "qa",
      status: "done",
      report: "Contrast fixed. Keyboard path + form labels OK. Ready for review.",
    },
    {
      delay: 800,
      type: "orch-summary",
      text:
        "Team report: Manager locked the page story, BD set offer + audience, Designer defined cream/espresso visuals, Dev stubbed the page, QA cleared the CTA contrast issue. Next: approve copy, then ship the hero.",
    },
  ];
}
