import * as Babel from "@babel/standalone";
import type { CodeFile } from "../types";

export type ModuleKind = "script" | "css" | "json";

export interface CompiledModule {
  /** Original file name, used in error messages and stack traces. */
  fileName: string;
  kind: ModuleKind;
  /** CommonJS output for scripts, raw source for CSS/JSON. */
  code: string;
}

export interface CompiledProject {
  /** Modules keyed by their normalized path (see `normalizePath`). */
  modules: Map<string, CompiledModule>;
  /** Normalized path of the entry module. */
  entry: string;
  /** Every non-relative import specifier, e.g. `date-fns` or `@/components/ui/button`. */
  bareImports: Set<string>;
}

const SCRIPT_EXTENSION = /\.(tsx|ts|jsx|js|mjs|cjs)$/;

/**
 * Turns a file name or import path into a module key: strips script
 * extensions and leading `./` or `/`, and collapses `.`/`..` segments.
 * CSS and JSON keep their extension so `./styles.css` and `./styles.tsx`
 * stay distinct.
 */
export const normalizePath = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.replace(SCRIPT_EXTENSION, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

export const isRelativeSpecifier = (specifier: string) =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier.startsWith("/") ||
  specifier === "." ||
  specifier === "..";

const getKind = (fileName: string): ModuleKind => {
  if (/\.css$/i.test(fileName)) return "css";
  if (/\.json$/i.test(fileName)) return "json";
  return "script";
};

/** Babel plugin that records the specifier of every value import/re-export. */
const collectImports = (into: Set<string>) => () => ({
  name: "react-exe-collect-imports",
  visitor: {
    // TypeScript elides type-only imports on Program enter, before these run.
    ImportDeclaration(path: any) {
      if (path.node.importKind !== "type") into.add(path.node.source.value);
    },
    ExportNamedDeclaration(path: any) {
      if (path.node.source && path.node.exportKind !== "type") {
        into.add(path.node.source.value);
      }
    },
    ExportAllDeclaration(path: any) {
      if (path.node.exportKind !== "type") into.add(path.node.source.value);
    },
    CallExpression(path: any) {
      const [arg] = path.node.arguments;
      if (path.node.callee.type === "Import" && arg?.type === "StringLiteral") {
        into.add(arg.value);
      }
    },
  },
});

const compileScript = (file: CodeFile, imports: Set<string>): string => {
  const result = Babel.transform(file.content, {
    filename: file.name,
    sourceType: "module",
    highlightCode: false,
    presets: [
      [
        "typescript",
        {
          allExtensions: true,
          isTSX: !/\.(ts|mts|cts)$/.test(file.name),
        },
      ],
      // Classic runtime: JSX compiles to React.createElement, and the module
      // wrapper always provides `React`, so code works without importing it.
      ["react", { runtime: "classic" }],
    ],
    plugins: [collectImports(imports), "transform-modules-commonjs"],
  });
  return result.code ?? "";
};

/**
 * Compiles a set of files into CommonJS modules. Throws with a file-annotated
 * Babel error (including a code frame) when a file fails to parse.
 */
export const compileProject = (files: CodeFile[]): CompiledProject => {
  if (files.length === 0) {
    throw new Error("No code to execute");
  }

  const modules = new Map<string, CompiledModule>();
  const bareImports = new Set<string>();

  for (const file of files) {
    const kind = getKind(file.name);
    const fileImports = new Set<string>();
    let code = file.content;

    if (kind === "script") {
      code = compileScript(file, fileImports);
    } else if (kind === "json") {
      try {
        JSON.parse(file.content);
      } catch (error) {
        throw new Error(`${file.name}: ${(error as Error).message}`);
      }
    }

    fileImports.forEach((specifier) => {
      if (!isRelativeSpecifier(specifier)) bareImports.add(specifier);
    });
    modules.set(normalizePath(file.name), { fileName: file.name, kind, code });
  }

  const entryFile = files.find((file) => file.isEntry) ?? files[0];

  return { modules, entry: normalizePath(entryFile.name), bareImports };
};
