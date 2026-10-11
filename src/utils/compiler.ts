import { transform, type Transform } from "sucrase";
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

// Specifiers in import/export statements and dynamic imports of the source.
// May over-match text inside strings; see `findImports`.
const SOURCE_IMPORT =
  /\b(?:import|export)\s[^;'"`]*?\bfrom\s*(['"])(.+?)\1|\bimport\s*(['"])(.+?)\3|\bimport\s*\(\s*(['"])(.+?)\5\s*\)/g;
const OUTPUT_REQUIRE = /\brequire\(\s*(['"])(.+?)\1\s*\)/g;

/**
 * Value imports of a compiled file: specifiers that appear in an import
 * statement of the source *and* survive as `require()` in the output. The
 * output excludes type-only and unused imports; the source check excludes
 * `require('x')` text that merely sits inside a string literal.
 */
const findImports = (source: string, output: string): string[] => {
  const declared = new Set<string>();
  for (const match of source.matchAll(SOURCE_IMPORT)) {
    declared.add(match[2] ?? match[4] ?? match[6]);
  }
  const imports = new Set<string>();
  for (const match of output.matchAll(OUTPUT_REQUIRE)) {
    if (declared.has(match[2])) imports.add(match[2]);
  }
  return Array.from(imports);
};

const codeFrame = (source: string, line: number, column: number) => {
  const lines = source.split("\n");
  const start = Math.max(line - 3, 0);
  const end = Math.min(line + 2, lines.length);
  const gutter = String(end).length;
  return lines
    .slice(start, end)
    .map((text, index) => {
      const number = start + index + 1;
      const prefix = `${number === line ? ">" : " "} ${String(number).padStart(gutter)} | `;
      const caret =
        number === line
          ? `\n${" ".repeat(gutter + 3)}| ${" ".repeat(Math.max(column - 1, 0))}^`
          : "";
      return prefix + text + caret;
    })
    .join("\n");
};

interface CompiledScript {
  code: string;
  imports: string[];
}

const compileScript = (file: CodeFile): CompiledScript => {
  const transforms: Transform[] = /\.(ts|mts|cts)$/.test(file.name)
    ? ["typescript", "imports"]
    : ["typescript", "jsx", "imports"];
  try {
    const { code } = transform(file.content, {
      transforms,
      filePath: file.name,
      // Classic runtime: JSX compiles to React.createElement, and the module
      // wrapper always provides `React`, so code works without importing it.
      jsxRuntime: "classic",
      production: true,
      // Browsers run modern syntax natively; only strip types and JSX.
      disableESTransforms: true,
    });
    return { code, imports: findImports(file.content, code) };
  } catch (error) {
    const { message, loc } = error as Error & { loc?: { line: number; column: number } };
    const reason = message.replace(/^Error transforming [^:]+: /, "");
    throw new Error(
      `${file.name}: ${reason}` +
        // Sucrase reports 1-based lines and columns.
        (loc ? `\n\n${codeFrame(file.content, loc.line, loc.column)}` : "")
    );
  }
};

// Unchanged files are reused across runs (e.g. editing one file of many).
const scriptCache = new Map<string, CompiledScript>();
const SCRIPT_CACHE_LIMIT = 200;

const compileScriptCached = (file: CodeFile): CompiledScript => {
  const key = `${file.name}\0${file.content}`;
  let compiled = scriptCache.get(key);
  if (!compiled) {
    compiled = compileScript(file);
    if (scriptCache.size >= SCRIPT_CACHE_LIMIT) scriptCache.clear();
    scriptCache.set(key, compiled);
  }
  return compiled;
};

/**
 * Compiles a set of files into CommonJS modules. Throws a file-annotated
 * error with a code frame when a file fails to parse.
 */
export const compileProject = (files: CodeFile[]): CompiledProject => {
  if (files.length === 0) {
    throw new Error("No code to execute");
  }

  const modules = new Map<string, CompiledModule>();
  const bareImports = new Set<string>();

  for (const file of files) {
    const kind = getKind(file.name);
    let code = file.content;

    if (kind === "script") {
      const compiled = compileScriptCached(file);
      code = compiled.code;
      compiled.imports.forEach((specifier) => {
        if (!isRelativeSpecifier(specifier)) bareImports.add(specifier);
      });
    } else if (kind === "json") {
      try {
        JSON.parse(file.content);
      } catch (error) {
        throw new Error(`${file.name}: ${(error as Error).message}`);
      }
    }

    modules.set(normalizePath(file.name), { fileName: file.name, kind, code });
  }

  const entryFile = files.find((file) => file.isEntry) ?? files[0];

  return { modules, entry: normalizePath(entryFile.name), bareImports };
};
