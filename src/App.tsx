import { useCallback, useEffect, useRef, useState } from 'react';
import { ExamRoom, PaletteButton, btn } from './components/ExamRoom';
import { Results } from './components/Results';
import aptitude from './data/aptitude-mock.json';
import quick from './data/quick-demo.json';
import { reduce, startAttempt, type Action, type AttemptState } from './engine/attempt';
import { parseExam, type ExamDef } from './engine/schema';
import { loadImported, loadSaved, save, saveImported } from './lib/storage';

const REPO_URL = 'https://github.com/ayushverma9408/cbt-exam-engine-9408';
const BUILT_IN = [quick, aptitude].map((json) => {
  const r = parseExam(json);
  if (!r.ok) throw new Error(`Invalid bundled exam: ${r.errors.join('; ')}`);
  return r.exam;
});

type View =
  | { name: 'home' }
  | { name: 'instructions'; exam: ExamDef }
  | { name: 'exam' | 'result'; exam: ExamDef; attempt: AttemptState };

function initialView(): View {
  const saved = loadSaved();
  if (!saved) return { name: 'home' };
  return { name: saved.attempt.submittedAt ? 'result' : 'exam', exam: saved.exam, attempt: saved.attempt };
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
    // Persist every change, so refreshing mid-exam resumes exactly where you were.
    if (view.name === 'exam' || view.name === 'result') save({ exam: view.exam, attempt: view.attempt });
  }, [view]);

  const dispatch = useCallback((action: Action) => {
    setView((v) => {
      if (v.name !== 'exam') return v;
      const attempt = reduce(v.exam, v.attempt, action);
      return { name: attempt.submittedAt ? 'result' : 'exam', exam: v.exam, attempt };
    });
  }, []);

  // Warn before closing the tab mid-exam.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (viewRef.current.name === 'exam') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const home = () => {
    save(null);
    setView({ name: 'home' });
  };

  switch (view.name) {
    case 'home':
      return <Home onPick={(exam) => setView({ name: 'instructions', exam })} />;
    case 'instructions':
      return (
        <Instructions
          exam={view.exam}
          onBack={home}
          onStart={() => setView({ name: 'exam', exam: view.exam, attempt: startAttempt(view.exam, Date.now()) })}
        />
      );
    case 'exam':
      return <ExamRoom exam={view.exam} attempt={view.attempt} dispatch={dispatch} />;
    case 'result':
      return (
        <Results
          exam={view.exam}
          attempt={view.attempt}
          onHome={home}
          onRetake={() => setView({ name: 'instructions', exam: view.exam })}
        />
      );
  }
}

function Home({ onPick }: { onPick: (exam: ExamDef) => void }) {
  const [imported, setImported] = useState<ExamDef[]>(loadImported);
  const [errors, setErrors] = useState<string[] | null>(null);

  const importFile = async (file: File) => {
    setErrors(null);
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return setErrors(['The file is not valid JSON.']);
    }
    const r = parseExam(json);
    if (!r.ok) return setErrors(r.errors.slice(0, 8));
    const next = [...imported.filter((e) => e.id !== r.exam.id), r.exam];
    setImported(next);
    saveImported(next);
  };

  const template = () => {
    const blob = new Blob([JSON.stringify(quick, null, 2)], { type: 'application/json' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'exam-template.json',
    }).click();
  };

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm text-white">CBT</span>
            CBT Exam Engine
          </div>
          <a href={REPO_URL} className="text-sm text-muted hover:text-ink">
            GitHub ↗
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <section className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Realistic computer-based test practice, in the browser
          </h1>
          <p className="mt-3 text-muted text-pretty">
            The same interface students face in JEE, NEET, CAT, SSC and banking exams — question palette,
            mark-for-review, sectional navigation, negative &amp; partial marking — followed by an analytics report.
          </p>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {[...BUILT_IN, ...imported].map((exam) => {
            const n = exam.sections.reduce((k, s) => k + s.questions.length, 0);
            return (
              <article key={exam.id} className="flex flex-col rounded-2xl border border-line bg-white p-5">
                <h2 className="font-semibold">{exam.title}</h2>
                {exam.description && <p className="mt-1 text-sm text-muted">{exam.description}</p>}
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Chip>{n} questions</Chip>
                  <Chip>{exam.durationMinutes} min</Chip>
                  <Chip>
                    {exam.sections.length} section{exam.sections.length > 1 ? 's' : ''}
                  </Chip>
                  {imported.includes(exam) && <Chip>imported</Chip>}
                </div>
                <button type="button" className={`${btn('primary')} mt-5 self-start`} onClick={() => onPick(exam)}>
                  Start test →
                </button>
              </article>
            );
          })}

          <article className="flex flex-col rounded-2xl border-2 border-dashed border-line-strong p-5">
            <h2 className="font-semibold">Bring your own questions</h2>
            <p className="mt-1 text-sm text-muted">
              Import an exam JSON file. It's validated before use, so a typo can't break a live test.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <label className={`${btn('primary')} cursor-pointer`}>
                Import .json
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
                />
              </label>
              <button type="button" className={btn('outline')} onClick={template}>
                Download template
              </button>
            </div>
            {errors && (
              <ul
                role="alert"
                className="mt-4 list-disc space-y-1 rounded-lg bg-danger/10 py-2 pr-3 pl-7 text-xs text-danger"
              >
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}

function Instructions({ exam, onStart, onBack }: { exam: ExamDef; onStart: () => void; onBack: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink">
          ← All tests
        </button>
        <div className="mt-4 rounded-2xl border border-line bg-white p-6">
          <h1 className="text-2xl font-semibold">{exam.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Chip>{exam.durationMinutes} minutes</Chip>
            {exam.sections.map((s) => (
              <Chip key={s.id}>
                {s.name}: {s.questions.length} Q · +{s.marking.correct}
                {s.marking.incorrect ? ` / −${s.marking.incorrect}` : ''}
              </Chip>
            ))}
          </div>

          <h2 className="mt-6 text-sm font-semibold">Instructions</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink/80">
            {exam.instructions.map((i) => (
              <li key={i}>{i}</li>
            ))}
            <li>
              Your progress is saved automatically — if the page reloads, you'll resume with the same time remaining.
            </li>
          </ol>

          <h2 className="mt-6 text-sm font-semibold">Question palette</h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ['not-visited', 'You have not visited the question yet'],
                ['not-answered', 'Visited but not answered'],
                ['answered', 'Answered and saved'],
                ['marked', 'Marked for review, not answered'],
                ['answered-marked', 'Answered and marked for review — will be evaluated'],
              ] as const
            ).map(([status, label], i) => (
              <div key={status} className="flex items-center gap-3">
                <PaletteButton number={i + 1} status={status} />
                <span className="text-muted">{label}</span>
              </div>
            ))}
          </div>

          <label className="mt-8 flex items-start gap-3 rounded-xl bg-page p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            I have read and understood the instructions.
          </label>
          <button type="button" className={`${btn('primary')} mt-4 w-full py-3`} disabled={!agreed} onClick={onStart}>
            I am ready to begin
          </button>
        </div>
      </main>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-page px-2.5 py-1 font-medium text-muted">{children}</span>;
}
