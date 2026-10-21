type Props = {
  className?: string;
  title?: string;
};

/** Honeycomb cluster mark — three hexes = crew in formation */
export function HiveLogo({ className, title = "Hive" }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="hiveCell" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0c070" />
          <stop offset="100%" stopColor="#d4a15c" />
        </linearGradient>
      </defs>
      {/* Top cell */}
      <path
        fill="url(#hiveCell)"
        d="M20 3.2 L28.2 7.9 L28.2 17.1 L20 21.8 L11.8 17.1 L11.8 7.9 Z"
      />
      {/* Bottom-left */}
      <path
        fill="url(#hiveCell)"
        d="M11.2 18.6 L19.4 23.3 L19.4 32.5 L11.2 37.2 L3 32.5 L3 23.3 Z"
        opacity="0.92"
      />
      {/* Bottom-right */}
      <path
        fill="url(#hiveCell)"
        d="M28.8 18.6 L37 23.3 L37 32.5 L28.8 37.2 L20.6 32.5 L20.6 23.3 Z"
        opacity="0.92"
      />
      {/* Soft gap lines so cells read as a hive, not a blob */}
      <path
        fill="none"
        stroke="#121416"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M20 21.8 L20 23.3 M19.4 23.3 L20.6 23.3"
        opacity="0.35"
      />
    </svg>
  );
}
