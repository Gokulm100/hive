# Sign-out → top-right — research handoff

Product choices (confirmed):

- Move the **whole account block** (avatar, name, Sign out) to the **top-right of the page**.
- On phones: **pinned top-right** even when the header wraps.
- Status pill (Live/Demo): user cares that sign-out/account sits page top-right; pill can stay in the header row (not blocking).

## For build / design

| Item | Detail |
|------|--------|
| Code | `src/components/Header.tsx` — `.auth-user-pill` inside `.top-actions` |
| Shell | `App.tsx` → `AuthGate` (no header) or `HiveApp` + `Header` |
| Sign out action | `onSignOut` → `useAuth().signOut()` → `POST /api/auth/logout` |
| Permissions | None; shown when `authUser` is set |
| Mobile menu | None; header uses `flex-wrap` only |
| Today’s order | Toggles → sound → account pill → **status badge last** (badge blocks “far right” in flow) |
| Styles | `src/index.css` — `.auth-user-pill`, `.auth-sign-out` |
| Spec | `docs/design/auth-ui.md` — avatar + Sign out in header (will need a small spec tweak if pinned) |

Suggested build approach (not implemented here):

- Pull account block out of `.top-actions` **or** use `position: fixed; top/right` on `.auth-user-pill` with z-index below modals (80).
- Match page padding (~20px) for inset; test light/dark and long GitHub names (ellipsis already on name).
