export type MapStyle = "bubbles" | "circuit";

type Props = {
  value: MapStyle;
  onChange: (style: MapStyle) => void;
  className?: string;
  /** Smaller label for map panel header row */
  compact?: boolean;
};

export function MapStyleSelect({
  value,
  onChange,
  className = "",
  compact = false,
}: Props) {
  return (
    <label
      className={`map-style-select${compact ? " map-style-select--compact" : ""}${className ? ` ${className}` : ""}`.trim()}
    >
      {!compact ? (
        <span className="map-style-select-label">Map style</span>
      ) : null}
      <select
        value={value}
        aria-label="Map style"
        onChange={(e) => onChange(e.target.value as MapStyle)}
      >
        <option value="bubbles">Bubbles</option>
        <option value="circuit">Circuit</option>
      </select>
    </label>
  );
}
