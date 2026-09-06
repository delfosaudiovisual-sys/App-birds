import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon } from './icons';

export function Meter({
  label,
  value,
  color,
  hint,
}: {
  label: ReactNode;
  /** 0-1 */
  value: number;
  color: string;
  hint?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter">
      <div className="meter__head">
        <span>{label}</span>
        <span className="meter__value" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <div className="meter__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      {hint && <div className="tiny dim">{hint}</div>}
    </div>
  );
}

export function Badge({
  children,
  color,
  outline,
}: {
  children: ReactNode;
  color?: string;
  outline?: boolean;
}) {
  if (outline) return <span className="badge badge--outline">{children}</span>;
  return (
    <span
      className="badge"
      style={{
        background: color ? `${color}22` : 'var(--accent-dim)',
        color: color ?? 'var(--accent-strong)',
        borderColor: color ? `${color}55` : 'transparent',
      }}
    >
      {children}
    </span>
  );
}

export function Notice({
  children,
  kind = 'warn',
}: {
  children: ReactNode;
  kind?: 'warn' | 'error' | 'info';
}) {
  const className = kind === 'error' ? 'notice notice--error' : kind === 'info' ? 'notice notice--info' : 'notice';
  return (
    <div className={className} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'info' ? <InfoIcon /> : <AlertIcon />}
      <span>{children}</span>
    </div>
  );
}

export function EvidenceList({ items }: { items: { label: string; ok: boolean; detail: string }[] }) {
  return (
    <ul className="evidence">
      {items.map((item, i) => (
        <li className="evidence__item" key={`${item.label}-${i}`}>
          <span className="evidence__mark" style={{ color: item.ok ? 'var(--accent-strong)' : 'var(--text-dim)' }}>
            {item.ok ? <CheckIcon /> : <CrossIcon />}
          </span>
          <span>
            <strong style={{ fontWeight: 600 }}>{item.label}</strong>
            <span className="dim"> — {item.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="switch-row">
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        {hint && <div className="field__hint">{hint}</div>}
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function ProgressRing({ value, size = 58 }: { value: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} className="dex-progress__ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-input)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dy="0.35em"
        textAnchor="middle"
        fill="var(--text)"
        fontSize={size * 0.28}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 650, color: 'var(--text-muted)', marginBottom: 4 }}>{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export const CONSERVATION_LABELS: Record<string, string> = {
  LC: 'Pouco preocupante',
  NT: 'Quase ameacada',
  VU: 'Vulneravel',
  EN: 'Em perigo',
  CR: 'Criticamente ameacada',
  DD: 'Dados insuficientes',
};

export const RARITY_LABELS: Record<number, string> = {
  1: 'Muito comum',
  2: 'Comum',
  3: 'Incomum',
  4: 'Rara',
  5: 'Muito rara',
};
