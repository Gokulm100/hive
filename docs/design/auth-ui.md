# Hive — sign-in UI (GitHub only)

Product choices: GitHub-only sign-in, open sign-up (first GitHub login creates an account), session expiry uses the same full-screen gate as logged-out.

## Colors

Reuse existing CSS variables from `src/index.css`:

| Role | Token | Dark | Light |
|------|-------|------|-------|
| Page background | `--bg`, gradients `--bg-glow-1/2` | `#121416` | `#f3f1ec` |
| Card surface | `--surface` | `#1c2126` | `#faf8f5` |
| Border | `--stroke` | `#2c343c` | `#d5d0c6` |
| Primary text | `--ink` | `#e6e9eb` | `#1a1f24` |
| Secondary text | `--ink-soft` | `#8b949c` | `#5c6670` |
| Primary action | `--accent` on `--accent-soft` hover | `#5fad92` | `#2f8f72` |
| Error / session note | `--blocked` | `#d47a76` | `#c45a56` |
| GitHub button fill | `#24292f` (dark) / `#1f2328` | fixed | fixed |
| GitHub button text | `#ffffff` | fixed | fixed |

## Fonts

- Logo wordmark: `--logo` (Bricolage Grotesque), same as header.
- Headline on card: `--display` (Fraunces), ~1.75rem, weight 700.
- Body, buttons, links: `--font` (DM Sans), 0.95–1rem.
- Legal / footnote: 0.8rem, `--ink-soft`.

## Layout

### Logged-out / session-expired (same screen)

Full viewport (`100dvh`), centered column, no app chrome (no header, no bubbles).

```
┌─────────────────────────────────────────────┐
│  [optional thin banner if session expired]  │
│                                             │
│         ┌─────────────────────┐             │
│         │  Hive logo + HIVE   │             │
│         │  Headline           │             │
│         │  One line subcopy   │             │
│         │  [ Continue with    │             │
│         │    GitHub ]         │             │
│         │  footnote (open     │             │
│         │  sign-up)           │             │
│         └─────────────────────┘             │
│                                             │
│  theme toggle bottom-right (reuse header)   │
└─────────────────────────────────────────────┘
```

- Card: max-width 420px, width 100%, padding 32px 28px, `--radius`, `--surface`, 1px `--stroke`, subtle `--shadow`.
- Background: same radial glows as main app body.
- Session expired: banner above card, `--blocked-soft` background, `--blocked` text, one sentence only.

### Login vs sign-up

Single screen. Toggle is copy-only:

- Default tab label: **Sign in**
- Secondary link: **Create an account** → switches headline/subcopy to welcome-new-user wording; **same GitHub button** (first OAuth login registers).

No password fields.

### Signed-in header (account cluster, top right)

Normal Hive app. The right side of the header is one row (wraps on small widths):

```
[ view · mode · engine toggles ] [ Sound ] [ status badge ]     [ avatar + name ] [ Sign out ]
```

- **Placement:** `top-bar-end` aligns controls to the right. The **account cluster** (avatar pill + Sign out) is the last item — furthest right, 10px gap from the status badge.
- **Avatar pill:** 28px avatar, truncated name (`--ink-soft`, 0.8rem), pill border `--stroke`, fill `--bar-bg`, max ~180px name width.
- **Sign out:** Ghost button — same as Sound (`btn-ghost` + `sound-toggle` sizing: 0.78rem, 8×12px padding, 10px radius, `--stroke` border, `--ink-soft` text).
- **Narrow screens (≤640px):** Hide the wide cluster. Show one ghost **Account menu** trigger (avatar + `⋯`, min 44px tap target, `aria-label="Account menu"`). Panel drops below, right-aligned: full name + full-width Sign out ghost button. Close on outside click or Escape.

## Colors (signed-in account)

| Role | Token |
|------|-------|
| Sign out label | `--ink-soft` (ghost default) |
| Sign out border | `--stroke` |
| Name in pill | `--ink-soft` |
| Name in menu panel | `--ink` |
| Menu surface | `--surface` + `--shadow` |

## Fonts (signed-in account)

- Name and Sign out: `--font` (DM Sans), 0.78–0.85rem.
- Menu panel name: 0.85rem, weight inherited (500 from pill context).

## Layout (builder checklist)

1. Move badge before the account cluster in DOM; cluster stays last in `top-bar-end`.
2. Do not put Sign out inside the avatar pill — adjacent ghost button in the same flex group (`gap: 8px`).
3. At 640px breakpoint, swap wide cluster for menu; do not show both.

## Main button (signed-in)

- **Label:** `Sign out`
- **Action:** POST logout, clear session, return to auth gate.

## Watch-out (signed-in)

**Truncated name on desktop:** The pill caps width; long GitHub handles ellipsize. The phone menu shows the full handle — do not rely on the pill alone for identity on small screens.

## Main screen flow

1. User opens app → loading spinner on gate while `/api/auth/me` runs.
2. Not signed in → full-screen gate (logged-out empty state).
3. User taps **Continue with GitHub** → browser goes to `/api/auth/github` → GitHub → callback → cookie set → redirect to `/`.
4. Signed in → main orchestration UI loads; all API calls send cookies.
5. Session expires or user signs out → gate again; if expiry, show session banner then same gate as step 2.

## Main button

- **Label:** `Continue with GitHub`
- **Action:** Starts GitHub OAuth (sign-in and sign-up use the same action).
- **Style:** Full-width, 48px min height, GitHub mark left, white label, dark fill; focus ring 2px `--accent`.

## Watch-out

**Low contrast on secondary copy:** `--ink-soft` on `--surface` in light mode can fail for small footnote text (~0.8rem). Keep footnotes at least 0.85rem and do not go lighter than `--ink-soft`; test light theme on the auth card.
