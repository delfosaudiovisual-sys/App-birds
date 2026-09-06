/**
 * Icones em traco, herdando `currentColor`.
 *
 * A classe `icon` e obrigatoria: um SVG inline sem width/height assume o
 * tamanho do viewBox e estoura o botao que o contem. O tamanho sai da variavel
 * --icon-size, que cada contexto ajusta no CSS ou no estilo do container.
 */
const base = {
  className: 'icon',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

export const MicIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);

export const StopIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export const CameraIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7a2 2 0 0 0 1.7-.95l.6-1.1A2 2 0 0 1 11.2 3h1.6a2 2 0 0 1 1.7.95l.6 1.1A2 2 0 0 0 16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="12.5" r="3.6" />
  </svg>
);

export const BookIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10a3 3 0 0 1 3 3v14a2.5 2.5 0 0 0-2.5-2.5H4z" />
    <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H14a3 3 0 0 0-3 3v14a2.5 2.5 0 0 1 2.5-2.5H20z" />
  </svg>
);

export const GearIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.04z" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);

export const AlertIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 3 2 20h20z" />
    <path d="M12 9v5M12 17.2v.1" />
  </svg>
);

export const InfoIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.1" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const CrossIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);

export const PlayIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 7h16M9.5 7V4.8A1.8 1.8 0 0 1 11.3 3h1.4a1.8 1.8 0 0 1 1.8 1.8V7M6.5 7l.8 12.3A1.8 1.8 0 0 0 9.1 21h5.8a1.8 1.8 0 0 0 1.8-1.7L17.5 7" />
  </svg>
);

export const UploadIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 16V4M8 8l4-4 4 4M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" />
  </svg>
);

export const PinIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);

export const SparkIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6 10.1 12.8 4.3 10.9 10.1 9z" />
  </svg>
);

/** Marcas de cada funcao de vocalizacao. */
export const SongTypeIcon = ({ kind }: { kind: string }) => {
  switch (kind) {
    case 'flag':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M6 21V4M6 4h11l-2.4 3.6L17 11H6" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 20s-7.4-4.6-7.4-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.4 2.8C19.4 15.4 12 20 12 20z" />
        </svg>
      );
    case 'alert':
      return <AlertIcon />;
    case 'seed':
      return (
        <svg {...base} aria-hidden="true">
          <path d="M12 21c-4.4 0-7-2.6-7-7 0-5.5 4.5-11 11-11 0 6.5-1.2 12-8 15" />
          <path d="M12 21c0-4 1.6-7.4 4.5-10" />
        </svg>
      );
    default:
      return (
        <svg {...base} aria-hidden="true">
          <path d="M9.5 14.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 1 1 5 5l-1 1" />
          <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 1 1-5-5l1-1" />
        </svg>
      );
  }
};

export const BirdMarkIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <circle cx="24" cy="24" r="23" fill="#132022" />
    <path
      d="M31.5 15.2a4.4 4.4 0 1 0-6.3 4l-8.7 5.6c-2.9 1.9-4 5.6-2.6 8.7l.5 1.1 3-2.2c.3 3 2.7 5.4 5.8 5.6l6.5.4-2.2-2.9c3.9-1.9 6.4-5.9 6.4-10.3v-6.2l4.3-2.6z"
      fill="#3fb98c"
    />
    <circle cx="30.4" cy="14.7" r="1.25" fill="#0b1113" />
  </svg>
);
