import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import ErrorBoundary from "./components/ErrorBoundary";
import { type CompiledProject, compileProject } from "./utils/compiler";
import {
  findMissingPackages,
  getEntryComponent,
  instantiateProject,
  type RuntimeInstance,
} from "./utils/runtime";
import {
  getSandboxImportMapScript,
  installHostModules,
  peekPackages,
  preconnectCDN,
  resolvePackages,
} from "./utils/cdn-resolver";
import type { CodeExecutorProps, CodeFile } from "./types";

export type { CodeExecutorConfig, CodeExecutorProps, CodeFile } from "./types";

// Heuristic speed bumps, not a security boundary.
const defaultSecurityPatterns = [
  /document\.cookie/i,
  /window\.document\.cookie/i,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /document\.write/i,
  /document\.location/i,
];

const SANDBOX_ROOT_ID = "__react-exe-sandbox-root";
const TAILWIND_CDN = "https://cdn.tailwindcss.com";

const EMPTY_DEPENDENCIES: Record<string, any> = {};

type RunState =
  | { status: "loading"; fetchingPackages: boolean }
  | { status: "ready"; Component: React.ComponentType; runId: number }
  | { status: "error"; error: string; forbiddenPatterns: boolean };

type Compiled =
  | { project: CompiledProject }
  | { error: string; forbiddenPatterns: boolean };

let runCounter = 0;

const toError = (error: unknown) =>
  error instanceof Error
    ? error
    : new Error((error as Error)?.message ?? String(error));

const toFiles = (code: string | CodeFile[]): CodeFile[] =>
  Array.isArray(code)
    ? code
    : [{ name: "index.tsx", content: code, isEntry: true }];

const sameFiles = (a: CodeFile[], b: CodeFile[]) =>
  a.length === b.length &&
  a.every(
    (file, index) =>
      file.name === b[index].name &&
      file.content === b[index].content &&
      file.isEntry === b[index].isEntry
  );

const sameDependencies = (a: Record<string, any>, b: Record<string, any>) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && a[key] === b[key])
  );
};

const samePatterns = (a: RegExp[], b: RegExp[]) =>
  a.length === b.length &&
  a.every((pattern, index) => String(pattern) === String(b[index]));

/** Keeps the previous value while `isEqual` says it is unchanged. */
function useStableValue<T>(value: T, isEqual: (a: T, b: T) => boolean): T {
  const ref = useRef(value);
  if (ref.current !== value && !isEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}

const findSecurityViolation = (files: CodeFile[], patterns: RegExp[]) => {
  for (const file of files) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(file.content)) {
        return `Forbidden code pattern detected in ${file.name}: ${pattern}`;
      }
    }
  }
  return null;
};

// Tailwind is injected after load (see `loadSandboxTailwind`) so it downloads
// in parallel with CDN packages instead of delaying the iframe's load event.
// The attribute still changes the srcdoc, so toggling Tailwind off reloads.
const buildSandboxSrcDoc = (enableTailwind: boolean) =>
  `<!DOCTYPE html><html${enableTailwind ? " data-tailwind" : ""}><head><meta charset="utf-8">` +
  getSandboxImportMapScript() +
  `<style>body{margin:0;background:transparent;font-family:system-ui;color:#0f172a;}` +
  `#${SANDBOX_ROOT_ID}{min-height:100vh;}</style></head>` +
  `<body><div id="${SANDBOX_ROOT_ID}"></div></body></html>`;

const TAILWIND_TIMEOUT_MS = 5000;
const sandboxTailwind = new WeakMap<Document, { ready: Promise<void>; done: boolean }>();

/** Loads Tailwind into a sandbox document once; never rejects. */
const loadSandboxTailwind = (doc: Document) => {
  let entry = sandboxTailwind.get(doc);
  if (!entry) {
    const script = doc.createElement("script");
    script.src = TAILWIND_CDN;
    const ready = new Promise<void>((resolve) => {
      script.onload = () => resolve();
      // Render unstyled rather than not at all if the CDN is down or slow.
      script.onerror = () => {
        console.warn(`[react-exe] Failed to load ${TAILWIND_CDN}`);
        resolve();
      };
      setTimeout(resolve, TAILWIND_TIMEOUT_MS);
    });
    const created = { ready: ready.then(() => void (created.done = true)), done: false };
    entry = created;
    sandboxTailwind.set(doc, entry);
    doc.head.appendChild(script);
  }
  return entry;
};

const prepareSandboxWindow = (win: Window) => {
  installHostModules(win);
  (win as any).React = React;
  // Best effort: hide the host from casual `window.parent` access.
  for (const property of ["parent", "top", "frameElement"]) {
    try {
      Object.defineProperty(win, property, {
        value: property === "frameElement" ? null : win,
        configurable: false,
      });
    } catch {
      // Some browsers refuse to redefine WindowProxy properties.
    }
  }
};

const errorTextStyle: React.CSSProperties = {
  margin: "8px 0 0 0",
  fontSize: "14px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "inherit",
};

const bypassButtonStyle: React.CSSProperties = {
  marginTop: "12px",
  padding: "8px 16px",
  backgroundColor: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "14px",
};

const loadingStyle: React.CSSProperties = {
  padding: "16px",
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "4px",
  color: "#374151",
};

const loadingMessage = (
  <p style={{ margin: 0, fontSize: "14px" }}>Loading dependencies from CDN...</p>
);

export const CodeExecutor: React.FC<CodeExecutorProps> = ({
  code,
  config = {},
}) => {
  const {
    containerClassName,
    containerStyle,
    errorClassName,
    errorStyle,
    onError,
    enableTailwind = false,
    autoResolvePackage = true,
    sandbox = true,
  } = config;

  // Inline config objects are new on every render; only re-run on real changes.
  const files = useStableValue(useMemo(() => toFiles(code), [code]), sameFiles);
  const dependencies = useStableValue(
    config.dependencies ?? EMPTY_DEPENDENCIES,
    sameDependencies
  );
  const securityPatterns = useStableValue(
    config.securityPatterns ?? defaultSecurityPatterns,
    samePatterns
  );

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [bypassedFiles, setBypassedFiles] = useState<CodeFile[] | null>(null);
  const [state, setState] = useState<RunState>({
    status: "loading",
    fetchingPackages: false,
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<{ root: Root; node: HTMLElement } | null>(null);
  // A new Document per iframe load (the WindowProxy object survives reloads).
  const [sandboxDocument, setSandboxDocument] = useState<Document | null>(null);

  const sandboxSrcDoc = useMemo(
    () => buildSandboxSrcDoc(enableTailwind),
    [enableTailwind]
  );

  const compiled = useMemo<Compiled | null>(() => {
    // Nothing executes during SSR, so skip compiling there.
    if (typeof document === "undefined") return null;
    const violation =
      bypassedFiles === files
        ? null
        : findSecurityViolation(files, securityPatterns);
    if (violation) return { error: violation, forbiddenPatterns: true };
    try {
      return { project: compileProject(files) };
    } catch (error) {
      return { error: toError(error).message, forbiddenPatterns: false };
    }
  }, [files, securityPatterns, bypassedFiles]);

  const reportError = useCallback((error: unknown, forbiddenPatterns = false) => {
    const err = toError(error);
    setState({ status: "error", error: err.message, forbiddenPatterns });
    onErrorRef.current?.(err);
  }, []);

  const handleRenderError = useCallback(
    (error: Error) => reportError(error),
    [reportError]
  );

  useEffect(() => {
    if (compiled && "error" in compiled) {
      reportError(compiled.error, compiled.forbiddenPatterns);
    }
  }, [compiled, reportError]);

  // Open CDN connections early, while the sandbox iframe is still loading.
  useEffect(() => {
    if (!compiled || "error" in compiled || !autoResolvePackage) return;
    if (findMissingPackages(compiled.project, dependencies).length > 0) {
      preconnectCDN({ sandbox });
    }
  }, [compiled, dependencies, autoResolvePackage, sandbox]);

  // Load missing packages (and sandbox Tailwind) → evaluate modules.
  useEffect(() => {
    if (!compiled || "error" in compiled) return;

    const targetWindow = sandbox ? sandboxDocument?.defaultView : window;
    if (!targetWindow) {
      setState({ status: "loading", fetchingPackages: false });
      return;
    }

    const { project } = compiled;
    const missing = findMissingPackages(project, dependencies);
    if (missing.length > 0 && !autoResolvePackage) {
      reportError(
        `Module not found: ${missing.join(", ")}. Provide ${
          missing.length > 1 ? "them" : "it"
        } in config.dependencies or enable autoResolvePackage.`
      );
      return;
    }

    let cancelled = false;
    let instance: RuntimeInstance | null = null;

    const run = (packages: Record<string, any>) => {
      if (cancelled) return;
      try {
        instance = instantiateProject(project, {
          React,
          dependencies,
          packages,
          realm: targetWindow,
        });
        const entryFileName =
          project.modules.get(project.entry)?.fileName ?? project.entry;
        const Component = getEntryComponent(instance.exports, entryFileName, React);
        setState({ status: "ready", Component, runId: ++runCounter });
      } catch (error) {
        reportError(error);
      }
    };

    const tailwind =
      sandbox && enableTailwind ? loadSandboxTailwind(targetWindow.document) : null;
    const cached = peekPackages(missing, targetWindow);

    if (cached && (!tailwind || tailwind.done)) {
      run(cached);
    } else {
      setState({ status: "loading", fetchingPackages: !cached });
      Promise.all([
        cached ?? resolvePackages(missing, targetWindow),
        tailwind?.ready,
      ]).then(
        ([packages]) => run(packages),
        (error) => {
          if (!cancelled) reportError(error);
        }
      );
    }

    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [
    compiled,
    dependencies,
    sandbox,
    sandboxDocument,
    enableTailwind,
    autoResolvePackage,
    reportError,
  ]);

  const unmountSandboxRoot = useCallback(() => {
    const current = rootRef.current;
    rootRef.current = null;
    if (current) {
      // Deferred: unmounting a root while React is rendering is not allowed.
      setTimeout(() => {
        current.root.unmount();
        current.node.remove();
      });
    }
  }, []);

  const sandboxDocumentRef = useRef<Document | null>(null);

  const handleSandboxLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    // Skip the initial about:blank document and repeat signals for one load.
    if (!doc?.defaultView || !doc.getElementById(SANDBOX_ROOT_ID)) return;
    if (doc === sandboxDocumentRef.current) return;
    sandboxDocumentRef.current = doc;
    prepareSandboxWindow(doc.defaultView);
    unmountSandboxRoot();
    setSandboxDocument(doc);
  }, [unmountSandboxRoot]);

  // The iframe can finish loading before hydration attaches onLoad (SSR).
  useEffect(() => {
    if (sandbox && iframeRef.current?.contentDocument?.readyState === "complete") {
      handleSandboxLoad();
    }
  }, [sandbox, handleSandboxLoad]);

  // Render into the sandbox with the host's React DOM.
  useEffect(() => {
    if (!sandbox) {
      unmountSandboxRoot();
      sandboxDocumentRef.current = null;
      setSandboxDocument(null);
      return;
    }
    const mountPoint = sandboxDocument?.getElementById(SANDBOX_ROOT_ID);
    if (!mountPoint) return;

    if (!rootRef.current) {
      // A fresh node per root keeps StrictMode remounts from sharing a container.
      const node = sandboxDocument!.createElement("div");
      mountPoint.appendChild(node);
      rootRef.current = { root: createRoot(node), node };
    }
    rootRef.current.root.render(
      state.status === "ready" ? (
        <ErrorBoundary key={state.runId} onError={handleRenderError} fallback={null}>
          <state.Component />
        </ErrorBoundary>
      ) : null
    );
  }, [sandbox, sandboxDocument, state, handleRenderError, unmountSandboxRoot]);

  useEffect(() => unmountSandboxRoot, [unmountSandboxRoot]);

  // Tailwind for non-sandboxed rendering is loaded into the host document.
  useEffect(() => {
    if (!enableTailwind || sandbox) return;
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-react-exe-tailwind="true"]'
    );
    if (existing) {
      const tailwind = (window as any).tailwind;
      if (tailwind?.config) {
        // Nudge the Play CDN to rescan for new classes.
        setTimeout(() => {
          tailwind.config = { ...tailwind.config };
        }, 100);
      }
      return;
    }
    const script = document.createElement("script");
    script.src = TAILWIND_CDN;
    script.setAttribute("data-react-exe-tailwind", "true");
    document.head.appendChild(script);
  }, [enableTailwind, sandbox]);

  const handleBypassSecurity = useCallback(() => {
    setBypassedFiles(files);
  }, [files]);

  const errorDetails = state.status === "error" && (
    <>
      <pre style={errorTextStyle}>{state.error}</pre>
      {state.forbiddenPatterns && (
        <button
          onClick={handleBypassSecurity}
          style={bypassButtonStyle}
          title="Warning: Proceeding may expose you to security risks"
        >
          Continue Anyway (Not Recommended)
        </button>
      )}
    </>
  );

  const isFetchingPackages = state.status === "loading" && state.fetchingPackages;

  if (sandbox) {
    return (
      <div
        className={["code-viewer", containerClassName].filter(Boolean).join(" ")}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 360,
          display: "flex",
          flexDirection: "column",
          ...containerStyle,
        }}
      >
        <iframe
          ref={iframeRef}
          title="React-EXE Sandbox"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={sandboxSrcDoc}
          onLoad={handleSandboxLoad}
          style={{
            width: "100%",
            height: "100%",
            flex: 1,
            display: "block",
            border: "none",
            backgroundColor: "transparent",
          }}
        />
        {isFetchingPackages && (
          <div
            className="code-viewer-loading"
            style={{ ...loadingStyle, position: "absolute", inset: 0 }}
          >
            {loadingMessage}
          </div>
        )}
        {state.status === "error" && (
          <div
            className={["code-viewer-error", errorClassName].filter(Boolean).join(" ")}
            style={{
              position: "absolute",
              inset: 0,
              overflow: "auto",
              backgroundColor: "rgba(254, 242, 242, 0.97)",
              border: "1px solid #fee2e2",
              borderRadius: "4px",
              color: "#dc2626",
              padding: "16px",
              ...errorStyle,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Error</p>
            {errorDetails}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={["code-viewer", containerClassName].filter(Boolean).join(" ")}
      style={containerStyle}
    >
      <span style={{ display: "none", position: "absolute" }}>
        Powered by{" "}
        <a href="https://www.npmjs.com/package/react-exe" target="_blank" rel="noreferrer">
          React-EXE
        </a>
      </span>
      {isFetchingPackages && (
        <div className="code-viewer-loading" style={loadingStyle}>
          {loadingMessage}
        </div>
      )}
      {state.status === "error" && (
        <div
          className={["code-viewer-error", errorClassName].filter(Boolean).join(" ")}
          style={{
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fee2e2",
            borderRadius: "4px",
            color: "#dc2626",
            ...errorStyle,
          }}
        >
          <p style={{ margin: 0, fontWeight: 500 }}>Error:</p>
          {errorDetails}
        </div>
      )}
      {state.status === "ready" && (
        <ErrorBoundary key={state.runId} onError={handleRenderError} fallback={null}>
          <state.Component />
        </ErrorBoundary>
      )}
    </div>
  );
};

export default React.memo(CodeExecutor);
