import type React from "react";

export interface CodeFile {
  name: string;
  content: string;
  isEntry?: boolean;
}

export interface CodeExecutorConfig {
  /**
   * Modules available to the executed code, keyed by import specifier.
   * Keys ending in `/*` match any sub-path, e.g. `"@/components/ui/*"`.
   */
  dependencies?: Record<string, any>;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  errorClassName?: string;
  errorStyle?: React.CSSProperties;
  securityPatterns?: RegExp[];
  onError?: (error: Error) => void;
  enableTailwind?: boolean;
  /** Load imports that are not in `dependencies` from esm.sh. Default: true. */
  autoResolvePackage?: boolean;
  /** Render inside an iframe with its own document. Default: true. */
  sandbox?: boolean;
}

export interface CodeExecutorProps {
  code: string | CodeFile[];
  config?: CodeExecutorConfig;
}
