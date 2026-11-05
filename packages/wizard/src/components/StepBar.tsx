import { Link } from '../lib/router';

export type Step = 'address' | 'plan' | 'testing' | 'report';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'address', label: 'Address' },
  { id: 'plan', label: 'Plan' },
  { id: 'testing', label: 'Testing' },
  { id: 'report', label: 'Report' },
];

/**
 * Where you are in a check-up. It only shows position: finished steps are links you can look at
 * (when there's something to go back to), the current one is marked, later ones are greyed out.
 * Stopping and deleting are separate buttons that ask first.
 */
export function StepBar({ current, links = {} }: { current: Step; links?: Partial<Record<Step, string>> }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Check-up steps" className="border-b border-rule bg-canvas">
      <div className="mx-auto max-w-workspace px-4 sm:px-6 lg:px-8">
        {/* Phones: just where you are. */}
        <p className="flex min-h-[44px] items-center gap-2 text-sm sm:hidden">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-ink text-xs font-bold"
          >
            {index + 1}
          </span>
          <span>
            Step {index + 1} of {STEPS.length}: <strong>{STEPS[index].label}</strong>
          </span>
        </p>
        <ol className="hidden items-center gap-2 text-sm sm:flex">
          {STEPS.map((step, i) => {
            const state = i < index ? 'done' : i === index ? 'current' : 'todo';
            const href = state === 'done' ? links[step.id] : undefined;
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] text-xs font-bold ${
                    state === 'done'
                      ? 'border-ink bg-ink text-surface'
                      : state === 'current'
                        ? 'border-ink bg-surface text-ink'
                        : 'border-edge text-ink-soft'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className={state === 'todo' ? 'text-ink-soft' : state === 'current' ? 'font-bold' : ''}>
                  {step.label}
                </span>
                <span className="sr-only">
                  {state === 'done' ? '(done)' : state === 'current' ? '(current step)' : '(to come)'}
                </span>
              </>
            );
            return (
              <li
                key={step.id}
                className="flex items-center gap-2"
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {href ? (
                  <Link
                    to={href}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-control px-1 hover:underline"
                  >
                    {content}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-[44px] items-center gap-2 px-1">{content}</span>
                )}
                {i < STEPS.length - 1 && (
                  <span aria-hidden="true" className={`h-px w-8 ${i < index ? 'bg-ink' : 'bg-edge/50'}`} />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
