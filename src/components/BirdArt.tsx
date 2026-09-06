import type { PlumageRegion, Species } from '../data/types';

/**
 * Retrato da ave desenhado em SVG a partir do proprio perfil visual da especie.
 *
 * Por que gerar em vez de embutir fotos: o app precisa funcionar offline e
 * inteiro, sem baixar nada e sem depender de licenca de imagem de terceiros.
 * O desenho usa a mesma paleta e a mesma silhueta que o identificador por foto
 * compara — entao o que o usuario ve na pokedex e literalmente o modelo que o
 * app tem daquela ave.
 */

interface Proportions {
  bodyRx: number;
  bodyRy: number;
  headR: number;
  headX: number;
  headY: number;
  tailLen: number;
  tailWide: number;
  billLen: number;
  billDeep: number;
  legLen: number;
  hooked: boolean;
  curved: boolean;
}

const SILHOUETTES: Record<Species['visual']['silhouette'], Proportions> = {
  passeriforme: { bodyRx: 26, bodyRy: 21, headR: 14, headX: 40, headY: 34, tailLen: 26, tailWide: 9, billLen: 10, billDeep: 5, legLen: 12, hooked: false, curved: false },
  psitacideo: { bodyRx: 25, bodyRy: 23, headR: 16, headX: 41, headY: 32, tailLen: 34, tailWide: 8, billLen: 11, billDeep: 11, legLen: 10, hooked: true, curved: true },
  tucano: { bodyRx: 27, bodyRy: 21, headR: 14, headX: 41, headY: 33, tailLen: 24, tailWide: 10, billLen: 34, billDeep: 13, legLen: 11, hooked: false, curved: true },
  rapinante: { bodyRx: 28, bodyRy: 24, headR: 16, headX: 42, headY: 31, tailLen: 26, tailWide: 13, billLen: 11, billDeep: 8, legLen: 14, hooked: true, curved: false },
  coruja: { bodyRx: 26, bodyRy: 24, headR: 21, headX: 46, headY: 30, tailLen: 15, tailWide: 12, billLen: 7, billDeep: 6, legLen: 11, hooked: true, curved: false },
  aquatica: { bodyRx: 27, bodyRy: 19, headR: 13, headX: 39, headY: 30, tailLen: 20, tailWide: 9, billLen: 24, billDeep: 5, legLen: 14, hooked: false, curved: false },
  pernalta: { bodyRx: 24, bodyRy: 18, headR: 12, headX: 40, headY: 26, tailLen: 16, tailWide: 8, billLen: 17, billDeep: 4, legLen: 30, hooked: false, curved: false },
  columbiforme: { bodyRx: 28, bodyRy: 22, headR: 13, headX: 39, headY: 32, tailLen: 26, tailWide: 12, billLen: 8, billDeep: 4, legLen: 10, hooked: false, curved: false },
  'beija-flor': { bodyRx: 19, bodyRy: 15, headR: 11, headX: 38, headY: 34, tailLen: 28, tailWide: 8, billLen: 26, billDeep: 3, legLen: 5, hooked: false, curved: false },
  terrestre: { bodyRx: 26, bodyRy: 21, headR: 13, headX: 40, headY: 28, tailLen: 28, tailWide: 10, billLen: 12, billDeep: 6, legLen: 24, hooked: true, curved: false },
};

function pick(species: Species, regions: PlumageRegion[], fallback: string): string {
  for (const region of regions) {
    const hit = species.visual.palette.find((p) => p.region === region);
    if (hit) return hit.hex;
  }
  return fallback;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface BirdArtProps {
  species: Species;
  /** silhueta cinza, para espécie ainda não descoberta */
  locked?: boolean;
  className?: string;
}

export function BirdArt({ species, locked = false, className }: BirdArtProps) {
  const p = SILHOUETTES[species.visual.silhouette];
  const dominant = species.visual.palette[0]?.hex ?? '#7a7a7a';

  const back = locked ? '#1c282c' : pick(species, ['dorso', 'asa'], dominant);
  const belly = locked ? '#1c282c' : pick(species, ['ventre', 'peito'], shade(back, 0.2));
  const head = locked ? '#1c282c' : pick(species, ['cabeca'], back);
  const wing = locked ? '#162125' : pick(species, ['asa', 'dorso'], shade(back, -0.18));
  const tail = locked ? '#162125' : pick(species, ['cauda', 'asa', 'dorso'], shade(back, -0.22));
  const bill = locked ? '#243136' : pick(species, ['bico'], shade(head, -0.35));

  const pattern = species.visual.pattern;
  const patternId = `pat-${species.id}`;
  const showBars = !locked && (pattern === 'barrado' || pattern === 'listrado');

  const cx = 62;
  const cy = 62;
  const beakTipX = p.headX - p.headR - p.billLen;

  return (
    <svg viewBox="0 0 124 124" className={className} role="img" aria-label={`Ilustracao de ${species.commonName}`}>
      <defs>
        <linearGradient id={`sky-${species.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={locked ? '#101a1d' : shade(back, 0.55)} stopOpacity={locked ? 1 : 0.28} />
          <stop offset="100%" stopColor="#0c1416" />
        </linearGradient>
        {showBars && (
          <pattern id={patternId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
            <rect width="7" height="7" fill={back} />
            <rect
              width={pattern === 'barrado' ? 7 : 2.6}
              height={pattern === 'barrado' ? 2.6 : 7}
              fill={shade(back, -0.55)}
              opacity="0.85"
            />
          </pattern>
        )}
      </defs>

      <rect width="124" height="124" fill={`url(#sky-${species.id})`} />

      {/* poleiro */}
      <path d="M8 108h108" stroke="#2b3a40" strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* pernas */}
      <g stroke={locked ? '#2a373c' : shade(bill, 0.1)} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d={`M${cx - 4} ${cy + p.bodyRy - 3} v${p.legLen}`} />
        <path d={`M${cx + 6} ${cy + p.bodyRy - 4} v${p.legLen - 2}`} />
      </g>

      {/* cauda */}
      <path
        d={`M${cx + p.bodyRx - 6} ${cy - 2}
            L${cx + p.bodyRx + p.tailLen} ${cy - p.tailWide + 2}
            L${cx + p.bodyRx + p.tailLen + 2} ${cy + p.tailWide}
            Z`}
        fill={tail}
      />

      {/* corpo */}
      <ellipse cx={cx} cy={cy} rx={p.bodyRx} ry={p.bodyRy} fill={showBars ? `url(#${patternId})` : back} />

      {/* ventre */}
      <path
        d={`M${cx - p.bodyRx + 3} ${cy + 2}
            a${p.bodyRx - 3} ${p.bodyRy - 2} 0 0 0 ${2 * (p.bodyRx - 4)} 0
            a${p.bodyRx - 4} ${p.bodyRy - 6} 0 0 1 ${-2 * (p.bodyRx - 4)} 0 Z`}
        fill={belly}
        opacity="0.94"
      />

      {/* asa dobrada */}
      <ellipse
        cx={cx + 3}
        cy={cy - 1}
        rx={p.bodyRx * 0.62}
        ry={p.bodyRy * 0.52}
        fill={showBars ? `url(#${patternId})` : wing}
        transform={`rotate(-14 ${cx + 3} ${cy - 1})`}
      />

      {/* cabeca */}
      <circle cx={p.headX} cy={p.headY} r={p.headR} fill={head} />

      {/* capuz ou mascara */}
      {!locked && (pattern === 'capuz' || pattern === 'mascarado') && (
        <path
          d={
            pattern === 'capuz'
              ? `M${p.headX - p.headR} ${p.headY} a${p.headR} ${p.headR} 0 0 1 ${2 * p.headR} 0 Z`
              : `M${p.headX - p.headR} ${p.headY - 3} h${2 * p.headR} v6 h${-2 * p.headR} Z`
          }
          fill={shade(head, -0.62)}
          opacity="0.9"
        />
      )}

      {/* bico */}
      {p.hooked ? (
        <path
          d={`M${p.headX - p.headR + 3} ${p.headY - p.billDeep / 2}
              L${beakTipX} ${p.headY - 1}
              Q${beakTipX - 1} ${p.headY + p.billDeep * 0.7} ${beakTipX + p.billLen * 0.35} ${p.headY + p.billDeep * 0.6}
              Z`}
          fill={bill}
        />
      ) : (
        <path
          d={`M${p.headX - p.headR + 3} ${p.headY - p.billDeep / 2}
              L${beakTipX} ${p.headY}
              L${p.headX - p.headR + 3} ${p.headY + p.billDeep / 2} Z`}
          fill={bill}
        />
      )}

      {/* olho */}
      <circle cx={p.headX - p.headR * 0.34} cy={p.headY - p.headR * 0.24} r={p.headR * 0.26} fill="#0a0f11" />
      {!locked && (
        <circle
          cx={p.headX - p.headR * 0.42}
          cy={p.headY - p.headR * 0.34}
          r={p.headR * 0.09}
          fill="#ffffff"
          opacity="0.85"
        />
      )}

      {locked && (
        <text
          x="62"
          y="70"
          textAnchor="middle"
          fill="#4d6167"
          fontSize="30"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          ?
        </text>
      )}
    </svg>
  );
}
