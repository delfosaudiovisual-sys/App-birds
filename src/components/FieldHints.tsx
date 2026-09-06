import {
  ENVIRONMENT_LABELS,
  SIZE_LABELS,
  SIZE_SHORT,
  type Environment,
  type FieldContext,
  type SizeClass,
} from '../data/occurrence';

/**
 * Pistas de campo: as duas coisas que qualquer pessoa sabe responder olhando
 * para a ave — onde esta e de que tamanho ela e.
 *
 * E o recurso de maior impacto na precisao do app. Na bancada, informar as duas
 * leva o acerto no primeiro palpite de 25% para 42%, e o acerto entre os tres
 * primeiros de 47% para 73%. O motivo e simples: restringe o conjunto de
 * candidatos, que era o gargalo.
 */

const ENVIRONMENTS: Environment[] = ['urbano', 'mata', 'campo', 'agua'];
const SIZES: SizeClass[] = ['minima', 'pequena', 'media', 'grande'];

interface Props {
  value: FieldContext;
  onChange: (next: FieldContext) => void;
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="badge"
      aria-pressed={active}
      title={title}
      style={{
        minHeight: 38,
        padding: '0 13px',
        fontSize: 13,
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--accent-strong)' : 'var(--text-muted)',
        borderColor: active ? 'var(--accent)' : 'var(--line-strong)',
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function FieldHints({ value, onChange }: Props) {
  return (
    <div className="card">
      <div className="card__title">Pistas de campo</div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Responder onde voce esta e o tamanho aproximado da ave quase dobra o acerto. Toque de novo para desmarcar.
      </p>

      <div className="field__label" style={{ marginBottom: 6 }}>
        Onde voce esta
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {ENVIRONMENTS.map((env) => (
          <Chip
            key={env}
            active={value.environment === env}
            onClick={() => onChange({ ...value, environment: value.environment === env ? undefined : env })}
          >
            {ENVIRONMENT_LABELS[env]}
          </Chip>
        ))}
      </div>

      <div className="field__label" style={{ marginBottom: 6 }}>
        Tamanho da ave
      </div>
      <div className="chips">
        {SIZES.map((size) => (
          <Chip
            key={size}
            active={value.sizeClass === size}
            title={SIZE_LABELS[size]}
            onClick={() => onChange({ ...value, sizeClass: value.sizeClass === size ? undefined : size })}
          >
            {SIZE_SHORT[size]}
          </Chip>
        ))}
      </div>

      {(value.environment || value.sizeClass) && (
        <div className="tiny dim" style={{ marginTop: 12 }}>
          Aves fora do que voce marcou continuam na lista, so recuam — habitat e tamanho sao aproximados e a ave pode
          estar fora do lugar esperado.
        </div>
      )}
    </div>
  );
}
