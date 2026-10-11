/**
 * CDN package resolver.
 *
 * Packages are loaded from esm.sh with React marked external, so their
 * modules contain bare `import "react"` specifiers. An import map points
 * those at small shim modules that re-export the host app's React, giving
 * every package the same React instance as the executed code.
 *
 * - Sandbox: the import map is part of the iframe's srcdoc (see
 *   `getSandboxImportMapScript`), and modules are imported from a script
 *   inside the iframe so they evaluate in its realm and use its document.
 * - No sandbox: browsers can't reliably add an import map to a page that is
 *   already running, so es-module-shims (shim mode) is loaded on demand to
 *   apply one.
 */
import { HOST_MODULES } from "./host-modules";

const HOST_MODULES_GLOBAL = "__REACT_EXE_HOST_MODULES__";

const ES_MODULE_SHIMS = {
  src: "https://cdn.jsdelivr.net/npm/es-module-shims@2.8.4/dist/es-module-shims.js",
  integrity:
    "sha384-XCYz0V79m/Nex83lKvfhMD2R7JHcINUuKrEt+xEoNmakEsh354CNM0h2mNT7xJqq",
};

const primaryUrl = (specifier: string) =>
  `https://esm.sh/${specifier}?external=react,react-dom&target=es2022`;

// jsDelivr bundles its own copy of React, so it only suits React-free packages.
const fallbackUrl = (specifier: string) =>
  `https://cdn.jsdelivr.net/npm/${specifier}/+esm`;

const cssUrl = (specifier: string) => `https://esm.sh/${specifier}`;

const isCssSpecifier = (specifier: string) => /\.css$/i.test(specifier);

const errorMessage = (error: unknown) =>
  (error as Error)?.message ?? String(error);

let importMap: { imports: Record<string, string> } | null = null;

/** Import map sending React specifiers to shims over the host's modules. */
const getHostImportMap = () => {
  if (!importMap) {
    const imports: Record<string, string> = {};
    for (const [specifier, value] of Object.entries(HOST_MODULES)) {
      const names = Object.keys(value).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name)
      );
      const source =
        `const m = globalThis.${HOST_MODULES_GLOBAL}[${JSON.stringify(specifier)}];\n` +
        `export default m;\n` +
        (names.length ? `export const { ${names.join(", ")} } = m;\n` : "");
      imports[specifier] = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    }
    importMap = { imports };
  }
  return importMap;
};

/** `<script type="importmap">` for the sandbox iframe's srcdoc. */
export const getSandboxImportMapScript = () =>
  `<script type="importmap">${JSON.stringify(getHostImportMap()).replace(
    /</g,
    "\\u003c"
  )}</script>`;

/** Exposes the host's React modules to the shims; call before importing. */
export const installHostModules = (win: Window) => {
  (win as any)[HOST_MODULES_GLOBAL] = HOST_MODULES;
};

const preconnected = new Set<string>();

/**
 * Adds `<link rel="preconnect">` for the CDNs a run is about to use. Sandbox
 * iframes share the page's connection pool, so warming it from the host
 * document overlaps the TLS handshake with the iframe's load.
 */
export const preconnectCDN = ({ sandbox }: { sandbox: boolean }) => {
  const origins = ["https://esm.sh"];
  if (!sandbox) origins.push(new URL(ES_MODULE_SHIMS.src).origin);
  for (const origin of origins) {
    if (preconnected.has(origin)) continue;
    preconnected.add(origin);
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
};

let importCounter = 0;

/**
 * Runs `import(url)` from a classic script inside `doc`, so the module is
 * linked with that document's import map and evaluated in its realm.
 */
const importInDocument = (url: string, doc: Document): Promise<any> =>
  new Promise((resolve, reject) => {
    const win = doc.defaultView as any;
    const key = `__reactExeImport${++importCounter}`;
    win[key] = { resolve, reject };
    const script = doc.createElement("script");
    script.textContent =
      `(function(c){delete window[${JSON.stringify(key)}];` +
      `import(${JSON.stringify(url)}).then(c.resolve,c.reject);})` +
      `(window[${JSON.stringify(key)}]);`;
    doc.head.appendChild(script);
    script.remove();
    if (key in win) {
      delete win[key];
      reject(
        new Error(
          "Could not run the module loader script; a Content Security Policy may be blocking inline scripts."
        )
      );
    }
  });

let importShimPromise: Promise<any> | null = null;

const loadImportShim = (): Promise<any> => {
  if (!importShimPromise) {
    importShimPromise = new Promise<any>((resolve, reject) => {
      const win = window as any;
      if (win.importShim?.addImportMap) {
        resolve(win.importShim);
        return;
      }
      win.esmsInitOptions = { ...win.esmsInitOptions, shimMode: true };
      const script = document.createElement("script");
      script.src = ES_MODULE_SHIMS.src;
      script.integrity = ES_MODULE_SHIMS.integrity;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () =>
        win.importShim?.addImportMap
          ? resolve(win.importShim)
          : reject(new Error("es-module-shims loaded without shim mode support"));
      script.onerror = () =>
        reject(new Error(`Failed to load ${ES_MODULE_SHIMS.src}`));
      document.head.appendChild(script);
    }).then((importShim) => {
      installHostModules(window);
      importShim.addImportMap(getHostImportMap());
      return importShim;
    });
    importShimPromise.catch(() => {
      importShimPromise = null;
    });
  }
  return importShimPromise;
};

const importModule = async (url: string, doc: Document) => {
  if (doc !== document) return importInDocument(url, doc);
  const importShim = await loadImportShim();
  return importShim(url);
};

const loadStylesheet = (specifier: string, doc: Document) =>
  new Promise<void>((resolve) => {
    const href = cssUrl(specifier);
    if (doc.querySelector(`link[data-react-exe-css="${CSS.escape(href)}"]`)) {
      resolve();
      return;
    }
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-react-exe-css", href);
    link.onload = () => resolve();
    link.onerror = () => {
      console.warn(`[react-exe] Failed to load stylesheet ${href}`);
      resolve();
    };
    doc.head.appendChild(link);
  });

// One cache per document: a reloaded sandbox keeps its WindowProxy but gets a
// new document and realm, so modules must not be shared across loads.
const caches = new WeakMap<Document, Map<string, Promise<any>>>();
const settled = new WeakMap<Document, Map<string, any>>();

const getMap = <T>(maps: WeakMap<Document, Map<string, T>>, doc: Document) => {
  let map = maps.get(doc);
  if (!map) {
    map = new Map();
    maps.set(doc, map);
  }
  return map;
};

/**
 * Returns the packages synchronously if all of them have already loaded into
 * `targetWindow`, so re-runs don't flash a loading state. Otherwise null.
 */
export const peekPackages = (
  specifiers: string[],
  targetWindow: Window = window
): Record<string, any> | null => {
  const loaded = settled.get(targetWindow.document);
  const packages: Record<string, any> = {};
  for (const specifier of specifiers) {
    if (!loaded?.has(specifier)) return null;
    packages[specifier] = loaded.get(specifier);
  }
  return packages;
};

/**
 * Loads a package from the CDN into `targetWindow` (defaults to the current
 * window). Results are cached per document.
 */
export const resolvePackageFromCDN = (
  specifier: string,
  targetWindow: Window = window
): Promise<any> => {
  const doc = targetWindow.document;
  const cache = getMap(caches, doc);
  const cached = cache.get(specifier);
  if (cached) return cached;

  const promise = isCssSpecifier(specifier)
    ? loadStylesheet(specifier, doc).then(() => ({}))
    : importModule(primaryUrl(specifier), doc).catch((primaryError) =>
        importModule(fallbackUrl(specifier), doc).catch((fallbackError) => {
          throw new Error(
            `Could not load "${specifier}" from CDN (${errorMessage(primaryError)}; ` +
              `fallback: ${errorMessage(fallbackError)})`
          );
        })
      );

  cache.set(specifier, promise);
  promise.then(
    (value) => getMap(settled, doc).set(specifier, value),
    () => cache.delete(specifier)
  );
  return promise;
};

/** Loads several packages; rejects with every failure listed. */
export const resolvePackages = async (
  specifiers: string[],
  targetWindow: Window = window
): Promise<Record<string, any>> => {
  const results = await Promise.allSettled(
    specifiers.map((specifier) => resolvePackageFromCDN(specifier, targetWindow))
  );
  const packages: Record<string, any> = {};
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") packages[specifiers[index]] = result.value;
    else failures.push(errorMessage(result.reason));
  });
  if (failures.length) throw new Error(failures.join("\n"));
  return packages;
};

/** Pre-loads a package into the cache. */
export const preloadPackage = async (
  specifier: string,
  targetWindow?: Window
): Promise<void> => {
  await resolvePackageFromCDN(specifier, targetWindow);
};

/** Clears cached CDN modules for the current window. */
export const clearCDNCache = (targetWindow: Window = window) => {
  caches.delete(targetWindow.document);
  settled.delete(targetWindow.document);
};
