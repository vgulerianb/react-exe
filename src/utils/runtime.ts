import type { ComponentType } from "react";
import {
  type CompiledProject,
  isRelativeSpecifier,
  normalizePath,
} from "./compiler";
import { HOST_MODULES } from "./host-modules";

export interface RuntimeOptions {
  React: any;
  /** User-provided modules; keys ending in `/*` match any sub-path. */
  dependencies: Record<string, any>;
  /** Packages loaded from the CDN, keyed by specifier. */
  packages?: Record<string, any>;
  /** Window whose realm runs the code and whose document receives CSS. */
  realm?: Window | null;
}

export interface RuntimeInstance {
  exports: any;
  /** Removes anything the run added to the document (e.g. CSS files). */
  dispose: () => void;
}

const findWildcardDependency = (
  specifier: string,
  dependencies: Record<string, any>
): string | undefined =>
  Object.keys(dependencies).find(
    (key) => key.endsWith("/*") && specifier.startsWith(key.slice(0, -1))
  );

/** Resolves a specifier to a local module key, or null if it is not local. */
const findLocalModule = (
  specifier: string,
  importer: string,
  project: CompiledProject
): string | null => {
  let base: string;
  const candidates: string[] = [];

  if (isRelativeSpecifier(specifier)) {
    const importerDir = specifier.startsWith("/")
      ? ""
      : importer.split("/").slice(0, -1).join("/");
    base = normalizePath(`${importerDir}/${specifier}`);
    candidates.push(base, `${base}/index`);
  } else {
    // `@/x` and `~/x` path aliases, plus bare names that match a file.
    base = normalizePath(specifier.replace(/^[@~]\//, ""));
    candidates.push(base, `${base}/index`, `src/${base}`, `src/${base}/index`);
  }

  return candidates.find((key) => project.modules.has(key)) ?? null;
};

/**
 * Lists bare imports that are neither provided, built in, nor local files,
 * i.e. the packages that must come from the CDN.
 */
export const findMissingPackages = (
  project: CompiledProject,
  dependencies: Record<string, any>
): string[] =>
  Array.from(project.bareImports).filter(
    (specifier) =>
      !(specifier in dependencies) &&
      !(specifier in HOST_MODULES) &&
      !findLocalModule(specifier, project.entry, project) &&
      !findWildcardDependency(specifier, dependencies)
  );

const facades = new WeakMap<object, any>();

/**
 * Adapts ES module namespaces (from the CDN or `import * as X`) to the shape
 * Babel's CommonJS interop expects. A module without a default export falls
 * back to the namespace itself, so `import x from "pkg"` keeps working.
 */
const toCommonJS = (value: any) => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const isNamespace = Object.prototype.toString.call(value) === "[object Module]";
  if (!isNamespace && !value.__esModule) return value;

  let facade = facades.get(value);
  if (!facade) {
    facade = { __esModule: true };
    for (const key of Object.keys(value)) {
      if (key === "default") continue;
      Object.defineProperty(facade, key, {
        enumerable: true,
        get: () => value[key],
      });
    }
    Object.defineProperty(facade, "default", {
      enumerable: true,
      get: () => (value.default !== undefined ? value.default : value),
    });
    facades.set(value, facade);
  }
  return facade;
};

/** Evaluates the compiled modules, starting from the entry. */
export const instantiateProject = (
  project: CompiledProject,
  { React, dependencies, packages = {}, realm }: RuntimeOptions
): RuntimeInstance => {
  const FunctionConstructor: FunctionConstructor =
    (realm as any)?.Function ?? Function;
  const document = realm?.document;
  const cache = new Map<string, { exports: any }>();
  const disposers: Array<() => void> = [];

  const requireFrom = (importer: string) => (specifier: string) => {
    if (specifier === "react") return React;
    if (specifier in dependencies) return toCommonJS(dependencies[specifier]);
    if (specifier in HOST_MODULES) return toCommonJS(HOST_MODULES[specifier]);

    const localKey = findLocalModule(specifier, importer, project);
    if (localKey) return load(localKey);

    const wildcard = findWildcardDependency(specifier, dependencies);
    if (wildcard) return toCommonJS(dependencies[wildcard]);

    if (specifier in packages) return toCommonJS(packages[specifier]);

    const fileName = project.modules.get(importer)?.fileName ?? importer;
    throw new Error(
      `Module not found: "${specifier}" (imported from ${fileName}). ` +
        `Add it to config.dependencies or enable autoResolvePackage.`
    );
  };

  const load = (key: string) => {
    const cached = cache.get(key);
    if (cached) return cached.exports;

    const compiled = project.modules.get(key);
    if (!compiled) throw new Error(`Module not found: "${key}"`);

    // Cache before evaluating so circular imports see partial exports.
    const module = { exports: {} as any };
    cache.set(key, module);

    try {
      if (compiled.kind === "json") {
        module.exports = JSON.parse(compiled.code);
      } else if (compiled.kind === "css") {
        if (document) {
          const style = document.createElement("style");
          style.setAttribute("data-react-exe", compiled.fileName);
          style.textContent = compiled.code;
          document.head.appendChild(style);
          disposers.push(() => style.remove());
        }
      } else {
        const factory = new FunctionConstructor(
          "module",
          "exports",
          "require",
          "React",
          `${compiled.code}\n//# sourceURL=react-exe:///${compiled.fileName}`
        );
        factory(module, module.exports, requireFrom(key), React);
      }
    } catch (error) {
      cache.delete(key);
      throw error;
    }
    return module.exports;
  };

  const dispose = () => disposers.splice(0).forEach((fn) => fn());

  try {
    return { exports: load(project.entry), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
};

const isComponentType = (value: any) =>
  typeof value === "function" ||
  (typeof value === "object" && value !== null && typeof value.$$typeof === "symbol");

/**
 * Picks the component to render from the entry module's exports: the default
 * export, else an `App` export, else the only capitalized component export.
 * A default-exported element (`export default <App />`) is wrapped.
 */
export const getEntryComponent = (
  exports: any,
  entryFileName: string,
  React: any
): ComponentType => {
  const candidate = exports?.default ?? exports?.App;

  if (candidate !== undefined) {
    if (React.isValidElement(candidate)) return () => candidate;
    if (isComponentType(candidate)) return candidate;
  } else if (typeof exports === "function") {
    // `module.exports = Component`
    return exports;
  } else {
    const named = Object.keys(exports ?? {}).filter(
      (key) => /^[A-Z]/.test(key) && isComponentType(exports[key])
    );
    if (named.length === 1) return exports[named[0]];
  }

  throw new Error(
    `${entryFileName} must default-export a React component, ` +
      `e.g. \`export default function App() { ... }\`. ` +
      `Got: ${candidate === undefined ? "no default export" : typeof candidate}.`
  );
};
