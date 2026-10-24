/** Mobile bubble map shell minimum heights (px). Keep in sync with `src/index.css`. */
export const BUBBLE_MAP_MOBILE_MIN_HEIGHT = {
  /** @media (max-width: 860px) */
  tablet: 440,
  /** @media (max-width: 520px) */
  phone: 420,
  /** @media (max-width: 860px) and (max-height: 700px) */
  short: 380,
} as const;

/** Minimum canvas wrap height inside map-shell on narrow viewports (px). */
export const BUBBLE_MAP_MOBILE_CANVAS_MIN_HEIGHT = 320;
