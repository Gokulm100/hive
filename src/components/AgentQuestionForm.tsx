import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ClarifyingQuestion, QuestionAnswer } from "../types";
import { play } from "../lib/sounds";

type Props = {
  agentName: string;
  questions: ClarifyingQuestion[];
  onSubmit: (answers: QuestionAnswer[], note: string) => void;
};

const OTHER = "__other__";

export function AgentQuestionForm({ agentName, questions, onSubmit }: Props) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [globalNote, setGlobalNote] = useState("");

  useEffect(() => {
    setChoices({});
    setNotes({});
    setGlobalNote("");
  }, [questions]);

  const ready = useMemo(
    () => questions.every((q) => !!choices[q.id]),
    [questions, choices]
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    play("send");
    const answers: QuestionAnswer[] = questions.map((q) => {
      const choiceId = choices[q.id];
      const fromList = q.choices.find((c) => c.id === choiceId);
      const label =
        choiceId === OTHER
          ? notes[q.id]?.trim() || "Other"
          : fromList?.label || choiceId;
      return {
        questionId: q.id,
        choiceId,
        choiceLabel: label,
        note: choiceId === OTHER ? undefined : notes[q.id]?.trim() || undefined,
      };
    });
    onSubmit(answers, globalNote.trim());
  }

  return (
    <form className="question-form" onSubmit={submit}>
      <p className="question-form-intro">
        <strong>{agentName}</strong> needs a few quick choices before starting.
      </p>
      {questions.map((q, index) => (
        <fieldset key={q.id} className="question-card">
          <legend>
            <span className="q-num">{index + 1}</span>
            {q.prompt}
          </legend>
          <div className="question-choices" role="radiogroup" aria-label={q.prompt}>
            {q.choices.map((c) => (
              <label key={c.id} className="choice-row">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  value={c.id}
                  checked={choices[q.id] === c.id}
                  onChange={() => {
                    play("click");
                    setChoices((prev) => ({ ...prev, [q.id]: c.id }));
                  }}
                />
                <span>{c.label}</span>
              </label>
            ))}
            {q.allowOther !== false ? (
              <label className="choice-row">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  value={OTHER}
                  checked={choices[q.id] === OTHER}
                  onChange={() => {
                    play("click");
                    setChoices((prev) => ({ ...prev, [q.id]: OTHER }));
                  }}
                />
                <span>Other</span>
              </label>
            ) : null}
          </div>
          {choices[q.id] === OTHER || q.allowOther !== false ? (
            <input
              className="question-note"
              type="text"
              placeholder={
                choices[q.id] === OTHER
                  ? "Type your own answer…"
                  : "Optional note for this question…"
              }
              value={notes[q.id] ?? ""}
              onChange={(e) =>
                setNotes((prev) => ({ ...prev, [q.id]: e.target.value }))
              }
              required={choices[q.id] === OTHER}
            />
          ) : null}
        </fieldset>
      ))}
      <label className="question-global">
        <span>Anything else? (optional)</span>
        <textarea
          rows={2}
          placeholder="Extra context for this agent…"
          value={globalNote}
          onChange={(e) => setGlobalNote(e.target.value)}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={!ready}>
        Continue
      </button>
    </form>
  );
}
