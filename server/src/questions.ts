export type QuestionChoice = {
  id: string;
  label: string;
};

export type ClarifyingQuestion = {
  id: string;
  prompt: string;
  choices: QuestionChoice[];
  allowOther?: boolean;
};

const DEFAULT_CHOICES: QuestionChoice[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure — you decide" },
];

function slug(s: string, i: number) {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return base || `q${i + 1}`;
}

function cleanLabel(s: string) {
  return s.replace(/^\s*[-*\d.)]+\s*/, "").trim();
}

/** Parse model output into radio-friendly questions */
export function parseStructuredQuestions(
  text: string
): ClarifyingQuestion[] | null {
  if (/^\s*NO_QUESTIONS\s*$/im.test(text.trim())) return [];

  // Prefer JSON block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        questions?: unknown;
      };
      if (Array.isArray(parsed.questions)) {
        const list = parsed.questions
          .map((q, i) => normalizeQuestion(q, i))
          .filter((q): q is ClarifyingQuestion => !!q)
          .slice(0, 3);
        return list;
      }
    } catch {
      /* fall through */
    }
  }

  // Legacy QUESTIONS: lines → each becomes a radio question with defaults
  const block = text.match(/QUESTIONS:\s*([\s\S]+)/i);
  if (block) {
    const lines = block[1]
      .split("\n")
      .map(cleanLabel)
      .filter(Boolean)
      .filter((l) => !/^IMPLEMENT/i.test(l))
      .slice(0, 3);
    if (!lines.length) return [];
    return lines.map((prompt, i) => ({
      id: `q${i + 1}`,
      prompt,
      choices: [...DEFAULT_CHOICES],
      allowOther: true,
    }));
  }

  if (text.includes("?") && text.length < 1200) {
    const lines = text
      .split("\n")
      .map(cleanLabel)
      .filter((l) => l.endsWith("?") || l.length > 12)
      .slice(0, 3);
    if (!lines.length) return null;
    return lines.map((prompt, i) => ({
      id: `q${i + 1}`,
      prompt,
      choices: [...DEFAULT_CHOICES],
      allowOther: true,
    }));
  }

  return null;
}

function normalizeQuestion(raw: unknown, i: number): ClarifyingQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const prompt = String(q.prompt ?? q.question ?? q.text ?? "").trim();
  if (!prompt) return null;

  let choices: QuestionChoice[] = [];
  if (Array.isArray(q.choices)) {
    choices = q.choices
      .map((c, j) => {
        if (typeof c === "string") {
          const label = c.trim();
          return label ? { id: slug(label, j), label } : null;
        }
        if (c && typeof c === "object") {
          const o = c as Record<string, unknown>;
          const label = String(o.label ?? o.text ?? o.value ?? "").trim();
          if (!label) return null;
          const id = String(o.id ?? slug(label, j));
          return { id, label };
        }
        return null;
      })
      .filter((c): c is QuestionChoice => !!c)
      .slice(0, 5);
  }

  if (choices.length < 2) {
    choices = [...DEFAULT_CHOICES];
  }

  return {
    id: String(q.id ?? `q${i + 1}`),
    prompt,
    choices,
    allowOther: q.allowOther !== false,
  };
}

export function formatAnswersForAgent(
  questions: ClarifyingQuestion[],
  answers: Array<{
    questionId: string;
    choiceId: string;
    choiceLabel: string;
    note?: string;
  }>
): string {
  return questions
    .map((q) => {
      const a = answers.find((x) => x.questionId === q.id);
      if (!a) return `• ${q.prompt}\n  → (no answer)`;
      const note = a.note?.trim() ? `\n  Extra note: ${a.note.trim()}` : "";
      return `• ${q.prompt}\n  → ${a.choiceLabel}${note}`;
    })
    .join("\n");
}
