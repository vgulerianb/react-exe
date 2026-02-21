import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import { cn, transformMultipleFiles } from "./utils";
import ErrorBoundary from "./components/ErrorBoundary";
import { resolvePackageFromCDN } from "./utils/cdn-resolver";

const defaultSecurityPatterns = [
  /document\.cookie/i,
  /window\.document\.cookie/i,
  /eval\(/i,
  /Function\(/i,
  /document\.write/i,
  /document\.location/i,
];

export interface CodeFile {
  name: string;
  content: string;
  isEntry?: boolean;
}

export interface CodeExecutorConfig {
  dependencies?: Record<string, any>;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  errorClassName?: string;
  errorStyle?: React.CSSProperties;
  securityPatterns?: RegExp[];
  onError?: (error: Error) => void;
  enableTailwind?: boolean;
  autoResolvePackage?: boolean;
  sandbox?: boolean;
}

export interface CodeExecutorProps {
  code: string | CodeFile[];
  config?: CodeExecutorConfig;
}

interface ExecutionResult {
  Component: React.ComponentType | null;
  error: string | null;
  forbiddenPatterns: boolean;
}

const initialExecutionResult: ExecutionResult = {
  Component: null,
  error: null,
  forbiddenPatterns: false,
};

// Helper function to compare code content
const isCodeDifferent = (
  prevCode: string | CodeFile[] | undefined,
  newCode: string | CodeFile[]
): boolean => {
  if (!prevCode) return true;

  if (typeof prevCode === "string" && typeof newCode === "string") {
    return prevCode !== newCode;
  }

  if (Array.isArray(prevCode) && Array.isArray(newCode)) {
    if (prevCode.length !== newCode.length) return true;

    return prevCode.some((file, index) => {
      const newFile = newCode[index];
      return (
        file.name !== newFile.name ||
        file.content !== newFile.content ||
        file.isEntry !== newFile.isEntry
      );
    });
  }

  return true;
};

// Helper function to compare dependencies
const isDependenciesDifferent = (
  prevDeps: Record<string, any> = {},
  newDeps: Record<string, any> = {}
): boolean => {
  const prevKeys = Object.keys(prevDeps);
  const newKeys = Object.keys(newDeps);

  if (prevKeys.length !== newKeys.length) return true;

  return prevKeys.some((key) => {
    const prevValue = prevDeps[key];
    const newValue = newDeps[key];

    // Compare only the reference for functions and objects
    if (typeof prevValue === "function" || typeof newValue === "function") {
      return prevValue !== newValue;
    }

    // For primitive values, compare the value
    return prevValue !== newValue;
  });
};

function executeCode(
  code: string | CodeFile[],
  dependencies: Record<string, any>,
  securityPatterns: RegExp[],
  bypassSecurity: boolean,
  autoResolvePackage: boolean = true,
  reactContext: typeof React = React,
  sandboxWindow?: Window | null
): ExecutionResult {
  try {
    const codeFiles = Array.isArray(code)
      ? code
      : [{ name: "index.tsx", content: code, isEntry: true }];

    // Security check
    if (!bypassSecurity) {
      for (const file of codeFiles) {
        for (const pattern of securityPatterns) {
          if (pattern.test(file.content)) {
            return {
              Component: null,
              error: `Forbidden code pattern detected in ${file.name}: ${pattern}`,
              forbiddenPatterns: true,
            };
          }
        }
      }
    }

    // Transform the code using our new system
    const transformedCode = transformMultipleFiles(
      codeFiles,
      dependencies,
      autoResolvePackage
    );

    // For debugging
    // console.log("Transformed code:", transformedCode);

    // Create the factory function and execute it
    const FunctionConstructor =
      (sandboxWindow ? (sandboxWindow as any).Function : undefined) || Function;
    const factoryFunction = new FunctionConstructor(transformedCode)();
    const Component = factoryFunction(reactContext, dependencies);

    return {
      Component,
      error: null,
      forbiddenPatterns: false,
    };
  } catch (err) {
    console.error("Error executing code:", err);
    return {
      Component: null,
      error: err instanceof Error ? err.message : "An unknown error occurred",
      forbiddenPatterns: false,
    };
  }
}

export const CodeExecutor: React.FC<CodeExecutorProps> = ({
  code,
  config = {},
}) => {
  const {
    dependencies = {},
    containerClassName,
    containerStyle,
    errorClassName,
    errorStyle,
    securityPatterns = defaultSecurityPatterns,
    onError,
    enableTailwind = false,
    autoResolvePackage = true,
    sandbox = true,
  } = config;

  const [executionResult, setExecutionResult] = useState<ExecutionResult>(
    initialExecutionResult
  );
  const [resolvedDependencies, setResolvedDependencies] = useState<
    Record<string, any>
  >(dependencies);
  const [isLoading, setIsLoading] = useState(false);
  const sandboxContext = sandbox ? "sandbox" : "parent";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRootRef = useRef<HTMLElement | null>(null);
  const iframeReactRootRef = useRef<any>(null);
  const [iframeReady, setIframeReady] = useState(false);

  const sandboxSrcDoc = useMemo(() => {
    const tailwindScript = enableTailwind
      ? '<script src="https://cdn.tailwindcss.com"></script>'
      : "";
    return `<!DOCTYPE html><html><head>${tailwindScript}<style>body{margin:0;background:transparent;font-family:system-ui;color:#0f172a;}#__react-exe-sandbox-root{min-height:100vh;}</style></head><body><div id="__react-exe-sandbox-root"></div></body></html>`;
  }, [enableTailwind]);

  const { Component, error, forbiddenPatterns } = executionResult;
  const prevCodeRef = useRef<string | CodeFile[]>();
  const prevDependenciesRef = useRef<Record<string, any>>();
  const prevSandboxContextRef = useRef<string>();

  // Check if code or dependencies have changed
  const hasChanges = useMemo(() => {
    const codeChanged = isCodeDifferent(prevCodeRef.current, code);
    const dependenciesChanged = isDependenciesDifferent(
      prevDependenciesRef.current,
      resolvedDependencies
    );
    const contextChanged =
      prevSandboxContextRef.current !== sandboxContext;

    return codeChanged || dependenciesChanged || contextChanged;
  }, [code, resolvedDependencies, sandboxContext]);

  const loadTailwind = useCallback(
    (targetDocument?: Document | null) => {
      if (!enableTailwind || !targetDocument) return;
      const existingScript = targetDocument.querySelector(
        'script[data-react-exe-tailwind="true"]'
      );

      if (existingScript) {
        const win = targetDocument.defaultView as any;
        if (win && win.tailwind && win.tailwind.config) {
          setTimeout(() => {
            win.tailwind.config = { ...win.tailwind.config };
          }, 100);
        }
        return;
      }

      const script = targetDocument.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.setAttribute("data-react-exe-tailwind", "true");
      targetDocument.head.appendChild(script);
    },
    [enableTailwind]
  );

  useEffect(() => {
    if (!enableTailwind || sandbox) return;
    loadTailwind(document);
  }, [enableTailwind, sandbox, loadTailwind]);

  useEffect(() => {
    return () => {
      iframeRootRef.current = null;
      iframeReactRootRef.current?.unmount?.();
      iframeReactRootRef.current = null;
    };
  }, []);

  // Extract missing dependencies and resolve them from CDN
  useEffect(() => {
    if (!hasChanges) {
      return;
    }

    if (!autoResolvePackage) {
      setResolvedDependencies(dependencies);
      setIsLoading(false);
      return;
    }

    const codeFiles = Array.isArray(code)
      ? code
      : [{ name: "index.tsx", content: code, isEntry: true }];

    const missingDeps = new Set<string>();
    codeFiles.forEach((file) => {
      const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(file.content)) !== null) {
        const importPath = match[1];
        if (
          importPath !== "react" &&
          !importPath.startsWith(".") &&
          !importPath.startsWith("/")
        ) {
          if (!dependencies[importPath]) {
            missingDeps.add(importPath);
          }
        }
      }
    });

    if (missingDeps.size === 0) {
      setResolvedDependencies(dependencies);
      setIsLoading(false);
      return;
    }

    const targetWindow =
      sandbox && iframeRef.current ? iframeRef.current.contentWindow : null;

    if (sandbox && (!iframeReady || !targetWindow)) {
      setIsLoading(true);
      return;
    }

    setIsLoading(true);
    const newDeps: Record<string, any> = { ...dependencies };
    let cancelled = false;

    const resolveDependencies = async () => {
      try {
        const resolvePromises = Array.from(missingDeps).map(async (dep) => {
          try {
            const resolved = await resolvePackageFromCDN(dep, targetWindow);
            return { dep, resolved };
          } catch (error) {
            console.warn(`Failed to resolve ${dep} from CDN:`, error);
            return { dep, resolved: null };
          }
        });

        const results = await Promise.all(resolvePromises);
        if (cancelled) return;

        results.forEach(({ dep, resolved }) => {
          if (resolved !== null) {
            newDeps[dep] = resolved;
            console.log(
              `Successfully resolved ${dep} from CDN${
                sandbox ? " inside sandbox" : ""
              }`
            );
          }
        });

        setResolvedDependencies(newDeps);
      } catch (error) {
        if (!cancelled) {
          console.error("Error resolving dependencies:", error);
          setResolvedDependencies(newDeps);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    resolveDependencies();

    return () => {
      cancelled = true;
    };
  }, [code, dependencies, autoResolvePackage, sandbox, iframeReady, hasChanges]);

  const renderInSandbox = useCallback(
    (component: React.ComponentType | null) => {
      if (!iframeRef.current) return;
      const iframeDocument = iframeRef.current.contentDocument;
      const sandboxWindow = iframeRef.current.contentWindow as any;
      if (!iframeDocument || !sandboxWindow) return;

      const mountNode =
        iframeRootRef.current ||
        iframeDocument.getElementById("__react-exe-sandbox-root");

      if (!mountNode) {
        console.warn("Sandbox root not found");
        return;
      }

      iframeRootRef.current = mountNode;

      if (!iframeReactRootRef.current) {
        iframeReactRootRef.current = createRoot(mountNode);
      }

      const sandboxReact =
        (sandboxWindow as any).React && typeof (sandboxWindow as any).React.createElement === "function"
          ? (sandboxWindow as any).React
          : React;

      iframeReactRootRef.current.render(
        component ? sandboxReact.createElement(component) : null
      );
    },
    []
  );

  const cleanupSandbox = useCallback(() => {
    if (iframeReactRootRef.current) {
      iframeReactRootRef.current.unmount();
      iframeReactRootRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!sandbox) {
      setIframeReady(false);
      cleanupSandbox();
    }
  }, [sandbox, cleanupSandbox]);

  const handleSandboxLoad = useCallback(() => {
    if (!iframeRef.current) return;
    const iframeWindow = iframeRef.current.contentWindow;
    setIframeReady(true);
    if (iframeWindow) {
      try {
        Object.defineProperty(iframeWindow, "parent", {
          value: iframeWindow,
          configurable: false,
        });
        Object.defineProperty(iframeWindow, "top", {
          value: iframeWindow,
          configurable: false,
        });
      } catch (error) {
        console.warn("Unable to harden sandbox window:", error);
      }
      (iframeWindow as any).React = React;
    }
  }, []);

  // Execute code on changes
  useEffect(() => {
    if (!hasChanges || isLoading) return;

    if (sandbox) {
      if (!iframeReady || !iframeRef.current) return;
      const sandboxWindow = iframeRef.current.contentWindow;

      if (!sandboxWindow) return;

      const sandboxAny = sandboxWindow as any;
      sandboxAny.React = sandboxAny.React || React;

      try {
        const result = executeCode(
          code,
          resolvedDependencies,
          securityPatterns,
          false,
          autoResolvePackage,
          sandboxAny.React,
          sandboxWindow
        );
        setExecutionResult(result);
        prevCodeRef.current = code;
        prevDependenciesRef.current = resolvedDependencies;
        prevSandboxContextRef.current = sandboxContext;
        if (result.Component) {
          renderInSandbox(result.Component);
        } else {
          cleanupSandbox();
        }
      } catch (err) {
        cleanupSandbox();
        const errorMessage = err instanceof Error ? err.message : String(err);
        setExecutionResult({
          Component: null,
          error: errorMessage,
          forbiddenPatterns: false,
        });
        if (onError && err instanceof Error) {
          onError(err);
        }
      }
    } else {
      try {
        const result = executeCode(
          code,
          resolvedDependencies,
          securityPatterns,
          false,
          autoResolvePackage
        );
        setExecutionResult(result);
        prevCodeRef.current = code;
        prevDependenciesRef.current = resolvedDependencies;
        prevSandboxContextRef.current = sandboxContext;
      } catch (err) {
        // Handle any synchronous errors during execution
        const errorMessage = err instanceof Error ? err.message : String(err);
        setExecutionResult({
          Component: null,
          error: errorMessage,
          forbiddenPatterns: false,
        });
        if (onError && err instanceof Error) {
          onError(err);
        }
      }
    }
  }, [
    code,
    resolvedDependencies,
    securityPatterns,
    hasChanges,
    isLoading,
    autoResolvePackage,
    onError,
    sandbox,
    iframeReady,
    renderInSandbox,
    cleanupSandbox,
  ]);

  const handleBypassSecurity = useCallback(() => {
    try {
      const targetWindow =
        sandbox && iframeRef.current ? iframeRef.current.contentWindow : undefined;
      const targetReact =
        sandbox && targetWindow
          ? ((targetWindow as any).React = (targetWindow as any).React || React)
          : React;
      const result = executeCode(
        code,
        resolvedDependencies,
        securityPatterns,
        true,
        autoResolvePackage,
        targetReact,
        targetWindow
      );
      setExecutionResult(result);
      prevCodeRef.current = code;
      prevDependenciesRef.current = resolvedDependencies;
      prevSandboxContextRef.current = sandboxContext;
      if (sandbox && result.Component) {
        renderInSandbox(result.Component);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setExecutionResult({
        Component: null,
        error: errorMessage,
        forbiddenPatterns: false,
      });
      if (onError && err instanceof Error) {
        onError(err);
      }
    }
  }, [
    code,
    resolvedDependencies,
    securityPatterns,
    autoResolvePackage,
    onError,
    sandbox,
    renderInSandbox,
  ]);

  const handleExecutionError = useCallback(
    (error: Error) => {
      if (sandbox) {
        cleanupSandbox();
      }
      setExecutionResult((prev) => ({
        ...prev,
        error: error.message,
        Component: null,
      }));
      if (onError) {
        onError(error);
      }
    },
    [onError, sandbox, cleanupSandbox]
  );

  if (isLoading) {
    return (
      <div
        className={cn("code-viewer-loading", containerClassName)}
        style={{
          padding: "16px",
          backgroundColor: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "4px",
          color: "#374151",
          ...containerStyle,
        }}
      >
        <p style={{ margin: 0, fontSize: "14px" }}>Loading dependencies from CDN...</p>
      </div>
    );
  }

  if (error && !sandbox) {
    return (
      <div
        className={cn("code-viewer-error", errorClassName)}
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
        <p style={{ margin: "8px 0 0 0", fontSize: "14px" }}>{error}</p>
        {forbiddenPatterns && (
          <div style={{ marginTop: "12px" }}>
            <button
              onClick={handleBypassSecurity}
              style={{
                padding: "8px 16px",
                backgroundColor: "#dc2626",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "14px",
              }}
              title="Warning: Proceeding may expose you to security risks"
            >
              Continue Anyway (Not Recommended)
            </button>
          </div>
        )}
      </div>
    );
  }

  const resolvedMinHeight =
    containerStyle && typeof containerStyle.minHeight !== "undefined"
      ? containerStyle.minHeight
      : 360;

  if (sandbox) {
    return (
      <div
        className={cn("code-viewer", containerClassName)}
        style={{
          ...containerStyle,
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: resolvedMinHeight,
          display: "flex",
          flexDirection: "column",
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
            minHeight: "100%",
            flex: 1,
            display: "block",
            border: "none",
            backgroundColor: "transparent",
          }}
        />
        {error && (
          <div
            className={cn("code-viewer-error", errorClassName)}
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(254, 242, 242, 0.95)",
              border: "1px solid #fee2e2",
              borderRadius: "4px",
              color: "#dc2626",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              ...errorStyle,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Error</p>
            <p style={{ marginTop: "8px", fontSize: "14px" }}>{error}</p>
            {forbiddenPatterns && (
              <button
                onClick={handleBypassSecurity}
                style={{
                  marginTop: "12px",
                  padding: "8px 16px",
                  backgroundColor: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Continue Anyway
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("code-viewer", containerClassName)}
      style={containerStyle}
    >
      <span
        style={{
          display: "none",
          position: "absolute",
        }}
      >
        Powered by{" "}
        <a
          href="https://www.npmjs.com/package/react-exe"
          target="_blank"
          rel="noreferrer"
        >
          React-EXE
        </a>
      </span>
      <ErrorBoundary
        onError={handleExecutionError}
        fallback={
          <div
            className={cn("code-viewer-error", errorClassName)}
            style={{
              padding: "16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fee2e2",
              borderRadius: "4px",
              color: "#dc2626",
              ...errorStyle,
            }}
          >
            <p style={{ margin: 0, fontWeight: 500 }}>Rendering Error:</p>
            <p style={{ margin: "8px 0 0 0", fontSize: "14px" }}>
              The component failed to render. Check the console for more
              details.
            </p>
          </div>
        }
      >
        {Component ? <Component /> : null}
      </ErrorBoundary>
    </div>
  );
};

export default React.memo(CodeExecutor);
