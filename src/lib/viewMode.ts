import type { ViewMode } from "../types";

/** Plain opens default to Bubbles; `?view=reports` keeps Reports bookmarks working. */
export function readViewFromLocation(): ViewMode {
  if (typeof window === "undefined") return "bubbles";
  const raw = new URLSearchParams(window.location.search).get("view");
  if (raw === "reports") return "reports";
  return "bubbles";
}

export function syncViewToLocation(view: ViewMode): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "reports") {
    url.searchParams.set("view", "reports");
  } else {
    url.searchParams.delete("view");
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(null, "", next);
  }
}
