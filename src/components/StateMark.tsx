import { STATE_META, type DoorState } from '../lib/status';

/** A state as shape + word, in the state's colour: never colour alone. */
export function StateMark({ state, label }: { state: DoorState; label?: string }) {
  const m = STATE_META[state];
  return (
    <span className={`hw-state hw-state--${state}`}>
      <span className="hw-state-mark" aria-hidden="true">
        {m.mark}
      </span>
      <span className="hw-state-word">{label ?? m.label}</span>
    </span>
  );
}
