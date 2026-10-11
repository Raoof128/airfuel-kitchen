import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Home,
  Search,
  CalendarDays,
  ShoppingBasket,
  BookOpen,
  Archive,
  Settings,
  Flame,
  Database,
  Menu,
  X,
  WifiOff,
  Heart,
  CircleHelp,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useKitchen, effectiveRecipes } from "./lib";
import { catalogue } from "./data/catalogue";
import { AppContext } from "./components/context";
import { Dashboard } from "./pages/Dashboard";
import { Explorer } from "./pages/Explorer";
import { RecipeDetail } from "./pages/RecipeDetail";
// Less common routes load on demand. Settings also keeps the optional cloud SDK out of the first load.
const Planner = lazy(() =>
  import("./pages/Planning").then((m) => ({ default: m.Planner })),
);
const Shopping = lazy(() =>
  import("./pages/Planning").then((m) => ({ default: m.Shopping })),
);
const Pantry = lazy(() =>
  import("./pages/Planning").then((m) => ({ default: m.Pantry })),
);
const Journal = lazy(() =>
  import("./pages/Journal").then((m) => ({ default: m.Journal })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.SettingsPage })),
);
const Help = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Help })),
);
const CustomRecipes = lazy(() =>
  import("./pages/CustomRecipes").then((m) => ({ default: m.CustomRecipes })),
);
const CookMode = lazy(() =>
  import("./pages/CookMode").then((m) => ({ default: m.CookMode })),
);
import { Modal, Empty } from "./components/UI";
import { subscribeToDraftReset } from "./lib/noteDrafts";
const nav = [
  ["/", "Today", Home],
  ["/explore", "Explore recipes", Search],
  ["/planner", "Meal planner", CalendarDays],
  ["/shopping", "Shopping list", ShoppingBasket],
  ["/journal", "Cooking journal", BookOpen],
  ["/pantry", "Pantry", Archive],
] as const;
// Mirrors the theme choice for index.html, which sets it before first paint.
const themeStorageKey = "airfuel-theme";
const pageTitles: Record<string, string> = {
  ...Object.fromEntries(nav),
  "/favourites": "Favourites",
  "/custom": "Your own recipes",
  "/settings": "Settings",
  "/help": "Kitchen guide",
};
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>Let’s get your kitchen back.</h1>
        <p>
          AirFuel couldn’t open its local data. Your data has not been deleted.
          Close other AirFuel tabs and reload. In private browsing, allow
          browser storage.
        </p>
        <button onClick={() => location.reload()}>Reload AirFuel</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Kitchen() {
  useEffect(() => subscribeToDraftReset(() => {}), []);
  const data = useKitchen();
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [routeRevision, setRouteRevision] = useState(0);
  // A failed save stays until dismissed; confirmations get their own slot so a
  // pinned error can never swallow a later success message.
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorToastRef = useRef<HTMLDivElement>(null);
  const [errorToastHeight, setErrorToastHeight] = useState(0);
  useLayoutEffect(() => {
    setErrorToastHeight(errorToastRef.current?.offsetHeight ?? 0);
  }, [errorToast, notice]);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(0);
  const latestOperation = useRef(0);
  const [online, setOnline] = useState(navigator.onLine);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const onHash = () => {
      setRoute(location.hash.slice(1) || "/");
      // Filter edits replace history without a hash event. A real navigation
      // must still reset the route even when its last rendered path is equal.
      setRouteRevision((revision) => revision + 1);
      setMenu(false);
      window.scrollTo(0, 0);
    };
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    // Until the saved preference loads, index.html's early theme stays in place.
    const theme = data?.preferences.theme;
    if (!theme) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && media.matches)
          ? "dark"
          : "light";
    };
    apply();
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Private browsing can block storage; the first-paint fallback is system.
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.preferences.theme]);
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  useEffect(() => {
    const path = route.split("?")[0];
    const label = path.startsWith("/cook/")
      ? "Cook Mode"
      : path.startsWith("/recipe/")
        ? "Recipe"
        : (pageTitles[path] ?? "Page not found");
    document.title = `${label} · AirFuel Kitchen`;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [route]);
  // Hooks run before the loading return so the context value keeps a stable identity.
  const navigate = useCallback((path: string) => {
    location.hash = path;
  }, []);
  const run = useCallback(
    async (operation: () => Promise<unknown>, message?: string) => {
      const operationId = ++latestOperation.current;
      setPending((n) => n + 1);
      try {
        await operation();
        if (message && operationId === latestOperation.current)
          setNotice(message);
        return true;
      } catch (error) {
        // A later background read must never hide a failed user save.
        setNotice(null);
        setErrorToast(
          error instanceof Error
            ? error.message.slice(0, 350)
            : "Could not save. Please try again or export a backup.",
        );
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [],
  );
  const recipes = useMemo(
    () => (data ? effectiveRecipes(catalogue, data) : []),
    [data],
  );
  const appValue = useMemo(
    () => (data ? { data, recipes, run, navigate } : null),
    [data, recipes, run, navigate],
  );
  if (!data || !appValue)
    return (
      <div className="loading">
        <Flame size={36} />
        <h1>Opening your kitchen…</h1>
        <p>Reading your saved recipes and cooking memories.</p>
      </div>
    );
  const path = route.split("?")[0];
  const cooking = path.startsWith("/cook/");
  let page: ReactNode;
  if (cooking)
    page = (
      <CookMode
        key={path}
        slug={path.slice(6)}
        initialServings={
          Number(new URLSearchParams(route.split("?")[1]).get("servings")) ||
          undefined
        }
      />
    );
  else if (path.startsWith("/recipe/"))
    page = <RecipeDetail key={path} slug={path.slice(8)} />;
  else if (path === "/explore" || path === "/favourites")
    page = (
      <Explorer
        key={`${route}:${routeRevision}`}
        query={route.split("?")[1] || ""}
        favourites={path === "/favourites"}
      />
    );
  else if (path === "/planner") page = <Planner />;
  else if (path === "/shopping") page = <Shopping />;
  else if (path === "/pantry") page = <Pantry />;
  else if (path === "/journal") page = <Journal />;
  else if (path === "/settings") page = <SettingsPage />;
  else if (path === "/help") page = <Help />;
  else if (path === "/custom") page = <CustomRecipes />;
  else if (path === "/") page = <Dashboard />;
  else
    page = (
      <Empty
        level={1}
        title="This page isn’t in your kitchen"
        action={
          <a className="button primary" href="#/">
            Back to Today
          </a>
        }
      />
    );
  return (
    <AppContext value={appValue}>
      <div className={`app-shell ${cooking ? "cooking-shell" : ""}`}>
        <a
          className="skip-link"
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
          }}
        >
          Skip to content
        </a>
        <header className="mobile-header">
          <a href="#/" className="brand">
            <Flame />
            AirFuel Kitchen
          </a>
          <button
            className="icon-button"
            aria-label={menu ? "Close navigation" : "Open navigation"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </header>
        <aside className="sidebar">
          <a href="#/" className="brand">
            <Flame fill="currentColor" size={32} />
            <span>
              AirFuel Kitchen
              <small>
                Good food fuels more
                <br />
                than today.
              </small>
            </span>
          </a>
          <nav aria-label="Main navigation">
            {nav.map(([href, label, Icon]) => (
              <a
                key={href}
                href={`#${href}`}
                className={path === href ? "active" : ""}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon size={20} />
                {label}
              </a>
            ))}
            <a
              href="#/favourites"
              className={path === "/favourites" ? "active" : ""}
              aria-current={path === "/favourites" ? "page" : undefined}
            >
              <Heart size={20} />
              Favourites
            </a>
          </nav>
          <div className="sidebar-bottom">
            <a
              href="#/settings"
              aria-current={path === "/settings" ? "page" : undefined}
            >
              <Settings size={20} />
              Settings
            </a>
            <a
              href="#/help"
              aria-current={path === "/help" ? "page" : undefined}
            >
              <CircleHelp size={20} />
              Kitchen guide
            </a>
            <div className="local-status">
              <Database size={19} />
              <span>
                {pending ? "Saving on this device…" : "Saved on this device"}
                <small>
                  {!online
                    ? "Offline · Your kitchen is open"
                    : offlineReady
                      ? "Ready for offline cooking"
                      : "Back up in Settings"}
                </small>
              </span>
            </div>
          </div>
        </aside>
        <main id="main" tabIndex={-1}>
          {/* The live region exists before its content changes, so screen readers announce it. */}
          <div role="status" aria-live="polite">
            {!online && (
              <div className="notice">
                <WifiOff size={17} />
                You’re offline. Your saved kitchen still works.
              </div>
            )}
            {needRefresh && (
              <div className="notice">
                A kitchen update is ready. Your personal data is kept.
                <button
                  onClick={() => void run(() => updateServiceWorker(true))}
                >
                  Update now
                </button>
              </div>
            )}
          </div>
          <Suspense
            fallback={
              <p className="route-loading" role="status">
                Opening this page…
              </p>
            }
          >
            {page}
          </Suspense>
          <footer className="site-footer">
            <span>Made for everyday cooking.</span>
            <a href="#/help">Nutrition, sources & safe cooking</a>
          </footer>
        </main>
        <nav className="mobile-bottom-nav" aria-label="Quick navigation">
          {nav.slice(0, 4).map(([href, label, Icon], i) => (
            <a
              key={href}
              href={`#${href}`}
              aria-label={label}
              aria-current={path === href ? "page" : undefined}
            >
              <Icon size={21} />
              <span>{["Today", "Explore", "Plan", "Shop"][i]}</span>
            </a>
          ))}
        </nav>
        {menu && (
          <Modal title="Your kitchen" onClose={() => setMenu(false)}>
            <nav className="mobile-menu" aria-label="All kitchen pages">
              {[
                ...nav,
                ["/favourites", "Favourites", Heart],
                ["/settings", "Settings", Settings],
                ["/help", "Kitchen guide", CircleHelp],
              ].map(([href, label, Icon]) => (
                <a
                  key={String(href)}
                  href={`#${href}`}
                  aria-current={path === href ? "page" : undefined}
                  onClick={() => setMenu(false)}
                >
                  <Icon size={22} />
                  {String(label)}
                </a>
              ))}
            </nav>
          </Modal>
        )}
        {errorToast && (
          <div className="toast error" role="alert" ref={errorToastRef}>
            {errorToast}
            <button
              aria-label="Dismiss message"
              onClick={() => setErrorToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div
            className={`toast ${errorToast ? "toast-stacked" : ""}`}
            role="status"
            style={
              errorToast
                ? ({
                    "--stack-offset": `${errorToastHeight + 10}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {notice}
            <button
              aria-label="Dismiss message"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </AppContext>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <Kitchen />
    </ErrorBoundary>
  );
}
