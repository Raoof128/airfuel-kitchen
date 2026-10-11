// A browsing location is UI state, not a route to an arbitrary external URL.
export function rememberExplore(hash: string) {
  if (!/^#\/(explore|favourites)(\?|$)/.test(hash)) return;
  try {
    sessionStorage.setItem("airfuel-explore-location", hash);
  } catch {
    // Browsing remains usable when optional session storage is unavailable.
  }
}

export function exploreReturnLocation() {
  try {
    const hash = sessionStorage.getItem("airfuel-explore-location");
    if (hash && /^#\/(explore|favourites)(\?|$)/.test(hash)) return hash;
  } catch {
    // The catalogue is always a safe fallback.
  }
  return "#/explore";
}

// "Delete personal data" also removes the remembered search, which can hold
// what the user was looking for.
export function forgetExploreLocation() {
  try {
    sessionStorage.removeItem("airfuel-explore-location");
  } catch {
    // Nothing is stored when session storage is unavailable.
  }
}
