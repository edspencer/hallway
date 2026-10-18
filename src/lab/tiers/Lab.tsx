// Design exploration only (tiers-design branch): `?lab=a…e` swaps the Local domains panel and the header's dialog
// for one of five treatments, over a macOS fixture with a simulated Turn on. `&ls=` picks a state (initial, system,
// none, running, done, failed), `&open=1` opens the dialog, `&fail=1` makes a clicked Turn on fail, `&bare=1` hides
// the switcher. Nothing here talks to the daemon.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trust } from '../../../shared/api';
import { CloseIcon } from '../../components/icons';
import { LAB_STATES, type LabRun, type LabStateId, VARIANTS, type VariantId, type VariantProps } from './model';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC, VariantCSheet } from './VariantC';
import { VariantD } from './VariantD';
import { VariantE } from './VariantE';
import './lab.css';

const PANELS: Record<VariantId, (p: VariantProps) => React.ReactNode> = { a: VariantA, b: VariantB, c: VariantC, d: VariantD, e: VariantE };

function params() {
  return new URLSearchParams(window.location.search);
}

/** The lab, if the URL asks for it. */
export function labVariant(): VariantId | null {
  const v = params().get('lab');
  return VARIANTS.some((x) => x.id === v) ? (v as VariantId) : null;
}

function fromState(s: LabStateId): { selected: Trust; run: LabRun | null } {
  if (s === 'system' || s === 'none') return { selected: s, run: null };
  if (s === 'running' || s === 'done' || s === 'failed') return { selected: 'user', run: { trust: 'user', phase: s } };
  return { selected: 'user', run: null };
}

export interface Lab {
  variant: VariantId;
  props: Omit<VariantProps, 'where'>;
  dialogOpen: boolean;
  dismissed: boolean;
  setVariant(v: VariantId): void;
  setLabState(s: LabStateId): void;
  labState: LabStateId;
  bare: boolean;
}

export function useLab(initial: VariantId | null, onCopy: (t: string, w?: string) => void, notify: (t: string) => void): Lab | null {
  const q = params();
  const [variant, setVariantRaw] = useState<VariantId>(initial ?? 'a');
  const [labState, setLabStateRaw] = useState<LabStateId>((LAB_STATES.find((s) => s.id === q.get('ls'))?.id ?? 'initial') as LabStateId);
  const [selected, setSelected] = useState<Trust>(fromState(labState).selected);
  const [run, setRun] = useState<LabRun | null>(fromState(labState).run);
  const [dialogOpen, setDialogOpen] = useState(q.get('open') === '1');
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback((k: string, v: string | null) => {
    const u = new URL(window.location.href);
    if (v === null) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
    window.history.replaceState(null, '', u);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const setLabState = useCallback(
    (s: LabStateId) => {
      if (timer.current) clearTimeout(timer.current);
      setLabStateRaw(s);
      const f = fromState(s);
      setSelected(f.selected);
      setRun(f.run);
      setDismissed(false);
      write('ls', s === 'initial' ? null : s);
    },
    [write],
  );
  if (!initial) return null;
  const turnOn = (t: Trust) => {
    if (timer.current) clearTimeout(timer.current);
    setSelected(t);
    setRun({ trust: t, phase: 'running' });
    const fail = params().get('fail') === '1';
    timer.current = setTimeout(() => setRun({ trust: t, phase: fail ? 'failed' : 'done' }), t === 'user' ? 3200 : 1800);
  };
  return {
    variant,
    labState,
    bare: q.get('bare') === '1',
    dialogOpen,
    dismissed,
    setVariant: (v) => {
      setVariantRaw(v);
      write('lab', v);
    },
    setLabState,
    props: {
      selected,
      select: setSelected,
      run,
      turnOn,
      reset: () => {
        if (timer.current) clearTimeout(timer.current);
        setRun(null);
      },
      onCopy,
      onDismiss: () => {
        setDismissed(true);
        notify('Hidden. The Local domains button at the top brings it back.');
      },
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
    },
  };
}

/** The panel on the page, in the lab's variant. */
export function LabPanel({ lab }: { lab: Lab }) {
  if (lab.dismissed) return null;
  const Panel = PANELS[lab.variant];
  return <Panel {...lab.props} where="panel" />;
}

/** The header's dialog, in the lab's variant: C has its own sheet; the rest put the panel in the dialog. */
export function LabDialog({ lab }: { lab: Lab }) {
  if (!lab.dialogOpen) return null;
  const close = lab.props.closeDialog;
  if (lab.variant === 'c')
    return (
      <div className="hw-help-wrap tl-sheet-wrap" onClick={close}>
        <VariantCSheet {...lab.props} where="dialog" />
      </div>
    );
  const Panel = PANELS[lab.variant];
  return (
    <div className="hw-help-wrap" onClick={close}>
      <div className="hw-help tl-dialog" role="dialog" aria-modal="true" aria-label="Local domains" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="hw-icon-btn tl-dialog-close" onClick={close} aria-label="Close (Esc)">
          <CloseIcon />
        </button>
        <Panel {...lab.props} where="dialog" />
        {lab.dismissed && (
          <p className="hw-help-foot">
            <button type="button" className="hw-link" onClick={() => lab.setLabState(lab.labState)}>
              Show this on the page again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/** The switcher: variant, state, theme, and opening the dialog. */
export function LabSwitcher({ lab }: { lab: Lab }) {
  if (lab.bare) return null;
  const theme = () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light';
  };
  return (
    <div className="tl-switch" role="toolbar" aria-label="Design lab">
      <span className="tl-switch-label">Design lab</span>
      <span className="tl-switch-group">
        {VARIANTS.map((v) => (
          <button key={v.id} type="button" className={`tl-switch-btn${lab.variant === v.id ? ' is-on' : ''}`} onClick={() => lab.setVariant(v.id)} title={v.name}>
            {v.id.toUpperCase()}
            <span className="tl-switch-name"> {v.name}</span>
          </button>
        ))}
      </span>
      <select className="tl-switch-select" value={lab.labState} onChange={(e) => lab.setLabState(e.target.value as LabStateId)} aria-label="State">
        {LAB_STATES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button type="button" className="tl-switch-btn" onClick={lab.props.openDialog}>
        Dialog
      </button>
      <button type="button" className="tl-switch-btn" onClick={theme}>
        Theme
      </button>
    </div>
  );
}
