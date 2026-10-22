export const ANIMS = [
  "anim-bob",
  "anim-wiggle",
  "anim-bounce",
  "anim-squash",
  "anim-tilt",
] as const;

export const CHAR = {
      orchestrator() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="18" fill="#F6D7B0"/>
          <path d="M14 30c2-14 34-14 36 0-2 4-8 7-18 7s-16-3-18-7z" fill="#1B3A4B"/>
          <path d="M18 22h28l-3-8H21z" fill="#E8C547"/>
          <circle cx="32" cy="16" r="3" fill="#F0D56A"/>
          <ellipse class="eye" cx="25" cy="34" rx="2.4" ry="3" fill="#1a1a1a"/>
          <ellipse class="eye delay" cx="39" cy="34" rx="2.4" ry="3" fill="#1a1a1a"/>
          <circle cx="26.2" cy="33" r="0.7" fill="#fff"/>
          <circle cx="40.2" cy="33" r="0.7" fill="#fff"/>
          <path d="M26 42c2.5 3 9.5 3 12 0" fill="none" stroke="#C48A6A" stroke-width="2" stroke-linecap="round"/>
          <path d="M20 48c4 8 20 8 24 0" fill="#2A6F7A"/>
        </svg>`;
      },
      researcher() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="17" fill="#E8C4A0"/>
          <path d="M16 30c3-12 29-12 32 0v2c-4 6-28 6-32 0z" fill="#2C3E50"/>
          <circle cx="25" cy="35" r="5.2" fill="none" stroke="#5D6D7E" stroke-width="1.8"/>
          <circle cx="39" cy="35" r="5.2" fill="none" stroke="#5D6D7E" stroke-width="1.8"/>
          <path d="M30.2 35h3.6" stroke="#5D6D7E" stroke-width="1.6"/>
          <ellipse class="eye" cx="25" cy="35" rx="2" ry="2.4" fill="#222"/>
          <ellipse class="eye delay" cx="39" cy="35" rx="2" ry="2.4" fill="#222"/>
          <path d="M28 42h8" stroke="#B07A5A" stroke-width="2" stroke-linecap="round"/>
          <rect x="42" y="36" width="13" height="16" rx="1.5" fill="#F4E8D0" stroke="#8A7A60" stroke-width="1"/>
          <path d="M45 40h7M45 44h7M45 48h5" stroke="#5B8A72" stroke-width="1.3"/>
          <path d="M18 48c5 9 23 9 28 0" fill="#5B8A72"/>
        </svg>`;
      },
      bd() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="33" r="17" fill="#C9956B"/>
          <path d="M15 28c4-13 30-13 34 0-6 3-28 3-34 0z" fill="#1F1F1F"/>
          <ellipse class="eye" cx="25" cy="33" rx="2.3" ry="2.8" fill="#111"/>
          <ellipse class="eye delay" cx="39" cy="33" rx="2.3" ry="2.8" fill="#111"/>
          <circle cx="22" cy="37" r="2.5" fill="#E8A090" opacity=".55"/>
          <circle cx="42" cy="37" r="2.5" fill="#E8A090" opacity=".55"/>
          <path d="M25 41c3.5 4.5 10.5 4.5 14 0" fill="none" stroke="#8B4E3A" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M18 48c4 9 24 9 28 0" fill="#2E5A3C"/>
          <path d="M32 48v10" stroke="#C4A35A" stroke-width="3"/>
          <path d="M28 50h8l-4 6z" fill="#C4A35A"/>
        </svg>`;
      },
      designer() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="17" fill="#F0C8B0"/>
          <path d="M14 32c2-16 34-16 36 0-8 8-28 8-36 0z" fill="#E85D75"/>
          <ellipse cx="32" cy="20" rx="14" ry="6" fill="#E85D75"/>
          <path d="M12 28c4-4 8-2 10 2" fill="#7EC8E3"/>
          <ellipse class="eye" cx="25" cy="34" rx="2.4" ry="3.1" fill="#222"/>
          <ellipse class="eye delay" cx="39" cy="34" rx="2.4" ry="3.1" fill="#222"/>
          <path d="M24 30c2-2 4-2 6 0" fill="none" stroke="#C07060" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M34 30c2-2 4-2 6 0" fill="none" stroke="#C07060" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="32" cy="40" r="2" fill="#E89A9A"/>
          <path d="M27 44c2 2 8 2 10 0" fill="none" stroke="#C07060" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M18 49c5 8 23 8 28 0" fill="#9B6B9E"/>
          <circle cx="48" cy="46" r="5" fill="#F4D35E"/>
          <circle cx="48" cy="46" r="2.5" fill="#E85D75"/>
        </svg>`;
      },
      dev() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="16" fill="#DDB892"/>
          <path d="M16 30c3-12 29-12 32 0 0 6-6 10-16 10s-16-4-16-10z" fill="#2D3142"/>
          <rect x="12" y="30" width="8" height="12" rx="4" fill="#2D3142"/>
          <rect x="44" y="30" width="8" height="12" rx="4" fill="#2D3142"/>
          <path d="M20 32h24" stroke="#4F5D75" stroke-width="3"/>
          <ellipse class="eye" cx="25" cy="35" rx="2.2" ry="2.7" fill="#1a1a1a"/>
          <ellipse class="eye delay" cx="39" cy="35" rx="2.2" ry="2.7" fill="#1a1a1a"/>
          <path d="M27 42c2 2.5 8 2.5 10 0" fill="none" stroke="#A67C52" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M18 48c5 9 23 9 28 0" fill="#3D5A80"/>
          <text x="32" y="56" text-anchor="middle" font-size="7" font-family="monospace" fill="#A8DADC">&lt;/&gt;</text>
        </svg>`;
      },
      qa() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="30" cy="34" r="16" fill="#F2D2B6"/>
          <path d="M15 29c3-12 27-12 30 0-4 5-26 5-30 0z" fill="#F4F1DE"/>
          <path d="M18 22h24v6H18z" fill="#F4F1DE"/>
          <ellipse class="eye" cx="24" cy="34" rx="2.1" ry="2.6" fill="#222"/>
          <ellipse class="eye delay" cx="36" cy="34" rx="2.1" ry="2.6" fill="#222"/>
          <path d="M26 41c2 2.2 6 2.2 8 0" fill="none" stroke="#B08A6A" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="46" cy="44" r="8" fill="none" stroke="#2A9D8F" stroke-width="3"/>
          <path d="M51 49l6 6" stroke="#2A9D8F" stroke-width="3" stroke-linecap="round"/>
          <path d="M16 48c5 8 22 8 27 0" fill="#E9C46A"/>
        </svg>`;
      },
      merger() {
        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="16" fill="#C8B6A0"/>
          <path d="M16 30c3-12 29-12 32 0-2 5-10 8-16 8s-14-3-16-8z" fill="#1B4332"/>
          <ellipse class="eye" cx="25" cy="34" rx="2.2" ry="2.7" fill="#1a1a1a"/>
          <ellipse class="eye delay" cx="39" cy="34" rx="2.2" ry="2.7" fill="#1a1a1a"/>
          <path d="M27 42c2.5 2.8 7.5 2.8 10 0" fill="none" stroke="#8B6914" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M18 48c5 9 23 9 28 0" fill="#2D6A4F"/>
          <circle cx="22" cy="20" r="3" fill="#40916C"/>
          <circle cx="42" cy="20" r="3" fill="#40916C"/>
          <path d="M22 20v8M42 20v8M22 28h20" fill="none" stroke="#95D5B2" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M32 28v10" stroke="#95D5B2" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M28 36l4 4 4-4" fill="none" stroke="#D8F3DC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      },
    };

export type CharRef =
  | string
  | {
      char?: string;
      customSvg?: string;
    };

export function charHtml(ref: CharRef | null | undefined, animClass = ""): string {
  let svg = "";
  if (ref && typeof ref === "object") {
    const key = ref.char as keyof typeof CHAR | undefined;
    svg = ref.customSvg || (key && CHAR[key] ? CHAR[key]() : "");
  } else if (typeof ref === "string" && ref in CHAR) {
    svg = CHAR[ref as keyof typeof CHAR]();
  }
  if (!svg) return "";
  return `<span class="char ${animClass}">${svg}</span>`;
}

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function makeCustomSvg(seed: string): string {
      const h = hashStr(seed);
      const skins = ["#F6D7B0", "#E8C4A0", "#C9956B", "#DDB892", "#F0C8B0", "#F2D2B6"];
      const hairs = ["#1F1F1F", "#3D2B1F", "#E85D75", "#2D3142", "#4A6FA5", "#6B3FA0"];
      const shirts = ["#2A6F7A", "#4A6FA5", "#2E5A3C", "#9B6B9E", "#3D5A80", "#E9C46A"];
      const skin = skins[h % skins.length];
      const hair = hairs[(h >> 3) % hairs.length];
      const shirt = shirts[(h >> 6) % shirts.length];
      const accent = hairs[(h >> 9) % hairs.length];
      return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="32" cy="34" r="17" fill="${skin}"/>
          <path d="M15 29c3-13 31-13 34 0-5 4-29 4-34 0z" fill="${hair}"/>
          <ellipse class="eye" cx="25" cy="34" rx="2.2" ry="2.8" fill="#222"/>
          <ellipse class="eye delay" cx="39" cy="34" rx="2.2" ry="2.8" fill="#222"/>
          <circle cx="26.2" cy="33" r="0.6" fill="#fff"/>
          <circle cx="40.2" cy="33" r="0.6" fill="#fff"/>
          <path d="M26 42c2.5 3 9.5 3 12 0" fill="none" stroke="#C48A6A" stroke-width="2" stroke-linecap="round"/>
          <path d="M18 48c5 9 23 9 28 0" fill="${shirt}"/>
          <circle cx="48" cy="46" r="4" fill="${accent}"/>
        </svg>`;
    }
