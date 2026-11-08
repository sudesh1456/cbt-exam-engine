import type { AttemptState, QuestionState, Status } from '../engine/attempt';
import { Exam, parseExam, type ExamDef } from '../engine/schema';

const KEY = 'cbt-exam-engine/v1';
export interface Saved { exam: ExamDef; attempt: AttemptState; }
const STATUSES: Status[] = ['not-visited', 'not-answered', 'answered', 'marked', 'answered-marked'];
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseAttempt(value: unknown, exam: ExamDef): AttemptState | null {
  if (!isRecord(value)) return null;
  const { examId, startedAt, endsAt, current, questions, submittedAt, enteredAt } = value;
  if (examId !== exam.id || typeof startedAt !== 'number' || !Number.isFinite(startedAt) ||
      typeof endsAt !== 'number' || !Number.isFinite(endsAt) || endsAt < startedAt ||
      typeof enteredAt !== 'number' || !Number.isFinite(enteredAt) ||
      (submittedAt !== null && (typeof submittedAt !== 'number' || !Number.isFinite(submittedAt))) ||
      typeof current !== 'string' || !isRecord(questions)) return null;
  const ids = exam.sections.flatMap((section) => section.questions.map((q) => q.id));
  if (!ids.includes(current) || ids.length !== Object.keys(questions).length) return null;
  const parsed: Record<string, QuestionState> = {};
  for (const id of ids) {
    const q = questions[id];
    if (!isRecord(q) || !STATUSES.includes(q.status as Status) ||
        typeof q.timeSpentMs !== 'number' || !Number.isFinite(q.timeSpentMs) || q.timeSpentMs < 0 ||
        !(q.response === null || typeof q.response === 'string' || (typeof q.response === 'number' && Number.isFinite(q.response)) ||
          (Array.isArray(q.response) && q.response.every((x) => typeof x === 'string'))) ||
        !(q.draft === null || typeof q.draft === 'string' || (typeof q.draft === 'number' && Number.isFinite(q.draft)) ||
          (Array.isArray(q.draft) && q.draft.every((x) => typeof x === 'string')))) return null;
    parsed[id] = q as unknown as QuestionState;
  }
  return { examId, startedAt, endsAt, current, questions: parsed, submittedAt, enteredAt };
}
function parseSaved(value: unknown): Saved | null {
  if (!isRecord(value)) return null;
  const parsedExam = Exam.safeParse(value.exam);
  if (!parsedExam.success) return null;
  const attempt = parseAttempt(value.attempt, parsedExam.data);
  return attempt ? { exam: parsedExam.data, attempt } : null;
}
export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = parseSaved(JSON.parse(raw));
    if (!saved) localStorage.removeItem(KEY);
    return saved;
  } catch { return null; }
}
export function save(value: Saved | null) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: the exam still works, it just can't resume */ }
}
const IMPORTED = 'cbt-exam-engine/imported';
export function loadImported(): ExamDef[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(IMPORTED) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => { const result = parseExam(item); return result.ok ? [result.exam] : []; });
  } catch { return []; }
}
export function saveImported(exams: ExamDef[]) {
  try { localStorage.setItem(IMPORTED, JSON.stringify(exams)); } catch { /* ignore */ }
}