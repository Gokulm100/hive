import { CharAvatar } from "./CharAvatar";
import { formatLogTime } from "../lib/utils";
import type { ActivityEntry, AgentDef, AgentRuntime } from "../types";

type Props = {
  cast: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  activityLog: ActivityEntry[];
};

export function DetailLog({ cast, agentState, activityLog }: Props) {
  if (!activityLog.length) {
    return (
      <section className="detail-log" aria-label="Agent activity detail log">
        <div className="detail-log-head">
          <h3>Detail log</h3>
          <span className="hint">Scroll down · full history per agent</span>
        </div>
        <div className="detail-log-body">
          <div className="detail-log-empty">
            No activity yet. Run a goal or instruct an agent.
          </div>
        </div>
      </section>
    );
  }

  const byAgent = new Map<string, ActivityEntry[]>();
  activityLog.forEach((e) => {
    if (!byAgent.has(e.id)) byAgent.set(e.id, []);
    byAgent.get(e.id)!.push(e);
  });

  const order = [
    ...cast.map((a) => a.id),
    ...[...byAgent.keys()].filter((id) => !cast.some((a) => a.id === id)),
  ];

  return (
    <section className="detail-log" aria-label="Agent activity detail log">
      <div className="detail-log-head">
        <h3>Detail log</h3>
        <span className="hint">Scroll down · full history per agent</span>
      </div>
      <div className="detail-log-body">
        {order
          .filter((id) => byAgent.has(id))
          .map((id) => {
            const a = cast.find((x) => x.id === id);
            const rows = byAgent.get(id)!;
            const last = rows[rows.length - 1];
            const status = agentState[id]?.status || last.status || "idle";
            const name = a?.name || last.name || id;
            const role = a?.role || "Former teammate";
            return (
              <article className="log-agent" data-id={id} key={id}>
                <div className="log-agent-head">
                  <CharAvatar refAgent={a} className="avatar" />
                  <div>
                    <p className="name">{name}</p>
                    <p className="role">{role}</p>
                  </div>
                  <span className={`chip ${status}`}>{status}</span>
                </div>
                <ul className="log-agent-entries">
                  {rows.map((e, i) => (
                    <li className={`kind-${e.kind}`} key={`${e.t}-${i}`}>
                      <span className="time">{formatLogTime(e.t)}</span>
                      <span className="tag">{e.kind}</span>
                      <span className="text">
                        {e.kind === "status" ? (
                          <>
                            <span className={`status-pill ${e.status}`}>
                              {e.status}
                            </span>
                            {e.text}
                          </>
                        ) : (
                          e.text
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
      </div>
    </section>
  );
}
