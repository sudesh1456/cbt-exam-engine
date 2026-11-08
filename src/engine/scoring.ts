import type { AttemptState } from './attempt';
import { hasValue } from './attempt';
import type { ExamDef, MarkingDef, QuestionDef, Response } from './schema';

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'unattempted';

export interface QuestionResult {
  id: string;
  sectionId: string;
  outcome: Outcome;
  marks: number;
  maxMarks: number;
  timeSpentMs: number;
  response: Response | null;
}

export interface SectionResult {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  correct: number;
  partial: number;
  incorrect: number;
  unattempted: number;
  accuracy: number; // correct / attempted
  timeSpentMs: number;
}

export interface ExamResult {
  score: number;
  maxScore: number;
  percentage: number;
  sections: SectionResult[];
  questions: QuestionResult[];
  attempted: number;
  accuracy: number;
  timeTakenMs: number;
  /** Marks lost to negative marking — a useful coaching signal. */
  negativeMarks: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Only *saved* responses count. Only responses that are answered (incl.
 * "answered & marked for review") are evaluated, as in real CBT exams.
 */
export function scoreQuestion(
  q: QuestionDef,
  marking: MarkingDef,
  response: Response | null,
): { outcome: Outcome; marks: number } {
  if (!hasValue(response)) return { outcome: 'unattempted', marks: 0 };

  switch (q.type) {
    case 'single':
      return response === q.answer
        ? { outcome: 'correct', marks: marking.correct }
        : { outcome: 'incorrect', marks: -marking.incorrect };

    case 'numeric': {
      if (typeof response !== 'number' || !Number.isFinite(response)) return { outcome: 'unattempted', marks: 0 };
      const value = response;
      return Math.abs(value - q.answer) <= q.tolerance + 1e-9
        ? { outcome: 'correct', marks: marking.correct }
        : { outcome: 'incorrect', marks: -marking.incorrect };
    }

    case 'multiple': {
      const chosen = new Set(Array.isArray(response) ? response : [String(response)]);
      const correct = new Set(q.answer);
      const wrongPicked = [...chosen].some((c) => !correct.has(c));
      if (wrongPicked) return { outcome: 'incorrect', marks: -marking.incorrect };
      if (chosen.size === correct.size) return { outcome: 'correct', marks: marking.correct };
      // Subset of the right options, no wrong ones.
      return marking.partial
        ? { outcome: 'partial', marks: round2((marking.correct * chosen.size) / correct.size) }
        : { outcome: 'incorrect', marks: -marking.incorrect };
    }
  }
}

export function scoreAttempt(exam: ExamDef, attempt: AttemptState): ExamResult {
  const questions: QuestionResult[] = [];
  const sections: SectionResult[] = exam.sections.map((section) => {
    const s: SectionResult = {
      id: section.id,
      name: section.name,
      score: 0,
      maxScore: 0,
      correct: 0,
      partial: 0,
      incorrect: 0,
      unattempted: 0,
      accuracy: 0,
      timeSpentMs: 0,
    };
    for (const q of section.questions) {
      const marking = q.marking ?? section.marking;
      const state = attempt.questions[q.id];
      const counts = state && (state.status === 'answered' || state.status === 'answered-marked');
      const response = counts ? state.response : null;
      const { outcome, marks } = scoreQuestion(q, marking, response);
      questions.push({
        id: q.id,
        sectionId: section.id,
        outcome,
        marks,
        maxMarks: marking.correct,
        timeSpentMs: state?.timeSpentMs ?? 0,
        response,
      });
      s.score += marks;
      s.maxScore += marking.correct;
      s[outcome === 'unattempted' ? 'unattempted' : outcome]++;
      s.timeSpentMs += state?.timeSpentMs ?? 0;
    }
    const attempted = s.correct + s.partial + s.incorrect;
    s.score = round2(s.score);
    s.accuracy = attempted ? round2((s.correct / attempted) * 100) : 0;
    return s;
  });

  const score = round2(sections.reduce((n, s) => n + s.score, 0));
  const maxScore = sections.reduce((n, s) => n + s.maxScore, 0);
  const attempted = questions.filter((q) => q.outcome !== 'unattempted').length;
  const correct = questions.filter((q) => q.outcome === 'correct').length;

  return {
    score,
    maxScore,
    percentage: maxScore ? round2((Math.max(0, score) / maxScore) * 100) : 0,
    sections,
    questions,
    attempted,
    accuracy: attempted ? round2((correct / attempted) * 100) : 0,
    timeTakenMs: (attempt.submittedAt ?? attempt.endsAt) - attempt.startedAt,
    negativeMarks: round2(-questions.filter((q) => q.marks < 0).reduce((n, q) => n + q.marks, 0)),
  };
}
