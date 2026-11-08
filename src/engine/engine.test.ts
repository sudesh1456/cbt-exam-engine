import { describe, expect, it } from 'vitest';
import aptitude from '../data/aptitude-mock.json';
import quick from '../data/quick-demo.json';
import { reduce, startAttempt, statusCounts, type AttemptState } from './attempt';
import { parseExam, type ExamDef } from './schema';
import { scoreAttempt, scoreQuestion } from './scoring';

const exam = parseExam({
  id: 'test',
  title: 'Test',
  durationMinutes: 10,
  sections: [
    {
      id: 's1',
      name: 'Section 1',
      marking: { correct: 4, incorrect: 1 },
      questions: [
        {
          id: 'q1',
          type: 'single',
          text: 'Q1',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          answer: 'a',
        },
        { id: 'q2', type: 'numeric', text: 'Q2', answer: 3.14, tolerance: 0.01 },
      ],
    },
    {
      id: 's2',
      name: 'Section 2',
      marking: { correct: 4, incorrect: 2, partial: true },
      questions: [
        {
          id: 'q3',
          type: 'multiple',
          text: 'Q3',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
            { id: 'c', text: 'C' },
            { id: 'd', text: 'D' },
          ],
          answer: ['a', 'b'],
        },
      ],
    },
  ],
});
if (!exam.ok) throw new Error(exam.errors.join('\n'));
const E: ExamDef = exam.exam;
const marking = E.sections[1].marking;
const q3 = E.sections[1].questions[0];

describe('schema', () => {
  it('reports readable errors', () => {
    const bad = parseExam({
      id: 'x',
      title: 'x',
      durationMinutes: 5,
      sections: [
        {
          id: 's',
          name: 's',
          marking: { correct: 1 },
          questions: [
            {
              id: 'q',
              type: 'single',
              text: 't',
              options: [
                { id: 'a', text: 'a' },
                { id: 'b', text: 'b' },
              ],
              answer: 'z',
            },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.errors[0]).toMatch(/sections\.0\.questions\.0\.answer: Answer "z" is not one of the options/);
  });

  it('rejects duplicate question ids', () => {
    const dup = parseExam({
      ...E,
      sections: [{ ...E.sections[0], questions: [E.sections[0].questions[0], E.sections[0].questions[0]] }],
    });
    expect(dup.ok).toBe(false);
  });
});

describe('scoreQuestion', () => {
  it('scores single-correct with negative marking', () => {
    const q1 = E.sections[0].questions[0];
    expect(scoreQuestion(q1, E.sections[0].marking, 'a')).toEqual({ outcome: 'correct', marks: 4 });
    expect(scoreQuestion(q1, E.sections[0].marking, 'b')).toEqual({ outcome: 'incorrect', marks: -1 });
    expect(scoreQuestion(q1, E.sections[0].marking, null)).toEqual({ outcome: 'unattempted', marks: 0 });
  });

  it('accepts numeric answers within tolerance', () => {
    const q2 = E.sections[0].questions[1];
    expect(scoreQuestion(q2, E.sections[0].marking, 3.15).outcome).toBe('correct');
    expect(scoreQuestion(q2, E.sections[0].marking, 3.16).outcome).toBe('incorrect');
  });

  it('awards partial marks only when no wrong option is chosen', () => {
    expect(scoreQuestion(q3, marking, ['a', 'b'])).toEqual({ outcome: 'correct', marks: 4 });
    expect(scoreQuestion(q3, marking, ['a'])).toEqual({ outcome: 'partial', marks: 2 });
    expect(scoreQuestion(q3, marking, ['a', 'c'])).toEqual({ outcome: 'incorrect', marks: -2 });
    expect(scoreQuestion(q3, { ...marking, partial: false }, ['a']).outcome).toBe('incorrect');
  });
});

describe('attempt reducer', () => {
  const t0 = 1_000_000;
  const run = (...actions: Parameters<typeof reduce>[2][]) =>
    actions.reduce<AttemptState>((s, a) => reduce(E, s, a), startAttempt(E, t0));

  it('starts on the first question with the rest not visited', () => {
    const s = startAttempt(E, t0);
    expect(s.current).toBe('q1');
    expect(statusCounts(s)).toMatchObject({ 'not-answered': 1, 'not-visited': 2 });
    expect(s.endsAt - s.startedAt).toBe(600_000);
  });

  it('only saves responses on Save & Next', () => {
    const s = run({ type: 'draft', value: 'a' }, { type: 'goto', id: 'q2', now: t0 + 1000 });
    expect(s.questions.q1).toMatchObject({ status: 'not-answered', response: null });
  });

  it('tracks statuses through save, mark and clear', () => {
    const s = run(
      { type: 'draft', value: 'a' },
      { type: 'save-next', now: t0 + 5_000 }, // q1 answered → q2
      { type: 'mark-next', now: t0 + 8_000 }, // q2 marked (no answer) → q3
      { type: 'draft', value: ['a'] },
      { type: 'save-mark-next', now: t0 + 20_000 }, // q3 answered & marked
    );
    expect(s.questions.q1.status).toBe('answered');
    expect(s.questions.q2.status).toBe('marked');
    expect(s.questions.q3.status).toBe('answered-marked');
    expect(s.questions.q1.timeSpentMs).toBe(5_000);
    expect(s.questions.q2.timeSpentMs).toBe(3_000);

    const cleared = reduce(E, reduce(E, s, { type: 'goto', id: 'q1', now: t0 + 21_000 }), { type: 'clear' });
    expect(cleared.questions.q1).toMatchObject({ status: 'not-answered', response: null });
  });

  it('freezes after submit and scores only saved answers', () => {
    const s = run(
      { type: 'draft', value: 'b' },
      { type: 'save-next', now: t0 + 1_000 }, // q1 wrong: −1
      { type: 'draft', value: 3.14 },
      { type: 'save-next', now: t0 + 2_000 }, // q2 right: +4
      { type: 'draft', value: ['a'] }, // q3 drafted but never saved
      { type: 'submit', now: t0 + 3_000 },
    );
    expect(reduce(E, s, { type: 'draft', value: 'a' })).toBe(s);

    const r = scoreAttempt(E, s);
    expect(r).toMatchObject({ score: 3, maxScore: 12, attempted: 2, negativeMarks: 1, timeTakenMs: 3_000 });
    expect(r.sections.map((x) => x.score)).toEqual([3, 0]);
    expect(r.accuracy).toBe(50);
  });

  it('never reports a negative percentage', () => {
    const s = run({ type: 'draft', value: 'b' }, { type: 'save-next', now: t0 + 1 }, { type: 'submit', now: t0 + 2 });
    expect(scoreAttempt(E, s).percentage).toBe(0);
  });
});

describe('bundled exams', () => {
  it.each([
    ['aptitude-mock', aptitude],
    ['quick-demo', quick],
  ])('%s is valid', (_name, json) => {
    const r = parseExam(json);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});


describe('regression fixes', () => {
  it('preserves an unsaved draft when the current question is selected again', () => {
    const start = startAttempt(E, 10_000);
    const drafted = reduce(E, start, { type: 'draft', value: 'b' });
    const selectedAgain = reduce(E, drafted, { type: 'goto', id: 'q1', now: 11_000 });
    expect(selectedAgain.questions.q1.draft).toBe('b');
    expect(selectedAgain.questions.q1.response).toBeNull();
  });

  it('does not save unfinished numeric text as an answer', () => {
    const start = startAttempt(E, 10_000);
    const drafted = reduce(E, start, { type: 'draft', value: '-' });
    const moved = reduce(E, drafted, { type: 'save-next', now: 11_000 });
    expect(moved.questions.q1.response).toBeNull();
    expect(moved.questions.q1.status).toBe('not-answered');
  });
});
