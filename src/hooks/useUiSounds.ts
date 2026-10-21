import { useEffect, useRef } from "react";
import { bindClickSounds, play } from "../lib/sounds";
import type { AgentRuntime } from "../types";

/** Global click sounds + chimes when agent statuses change */
export function useUiSounds(agentState: Record<string, AgentRuntime>) {
  const prev = useRef<Record<string, string>>({});

  useEffect(() => bindClickSounds(), []);

  useEffect(() => {
    const prevMap = prev.current;
    for (const [id, runtime] of Object.entries(agentState)) {
      const before = prevMap[id];
      const after = runtime.status;
      if (before && before !== after) {
        if (after === "done") play("success");
        else if (after === "blocked") play("wait");
        else if (after === "working") play("pop");
      }
      prevMap[id] = after;
    }
    prev.current = prevMap;
  }, [agentState]);
}
