import { NodePath } from "@babel/core";
import * as t from "@babel/types";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { transform } from "./babel-transformer";
import type { CodeFile } from "../index";

const moduleCache = new Map<string, string>();

export const transformMultipleFiles = (
  files: CodeFile[],
  dependencies: Record<string, any>,
  autoResolvePackage: boolean = true
) => {
  moduleCache.clear();

  // First pass: preprocess files to extract export information
  const exportInfo = new Map<
    string,
    {
      hasDefaultExport: boolean;
      namedExports: Set<string>;
      exportedName: string | null;
    }
  >();

  files.forEach((file) => {
    const { modifiedInput, exportedName } = removeDefaultExport(file.content);

    // Find named exports - more comprehensive approach
    const namedExports = new Set<string>();

    // Match regular named exports
    const exportRegex =
      /export\s+(const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g;
    let match;

    while ((match = exportRegex.exec(modifiedInput)) !== null) {
      namedExports.add(match[2]);
    }

    // Match "export { x, y, z }" style exports
    const exportBraceRegex = /export\s+{([^}]+)}/g;
    while ((match = exportBraceRegex.exec(modifiedInput)) !== null) {
      const exportsList = match[1].split(",");
      for (const exportItem of exportsList) {
        // Handle "originalName as exportName" syntax
        const nameParts = exportItem.trim().split(/\s+as\s+/);
        const exportName =
          nameParts.length > 1 ? nameParts[1].trim() : nameParts[0].trim();
        if (exportName) namedExports.add(exportName);
      }
    }

    exportInfo.set(file.name, {
      hasDefaultExport: exportedName !== null,
      namedExports,
      exportedName,
    });
  });

  // Transform all files
  files.forEach((file) => {
    const fileExportInfo = exportInfo.get(file.name);
    const { modifiedInput, exportedName } = removeDefaultExport(file.content);

    const dependencyVarMap = new Map<string, string>();
    Object.keys(dependencies).forEach((dep) => {
      const safeName = dep.replace(/[^a-zA-Z0-9_]/g, "_");
      dependencyVarMap.set(dep, safeName);
    });

    // Pre-process to handle various exports
    let processedInput = modifiedInput;

    // Replace "export const/function" with plain declarations
    processedInput = processedInput.replace(
      /export\s+(const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g,
      "$1 $2"
    );

    // Handle "export { x, y, z }" syntax - remove these lines
    processedInput = processedInput.replace(/export\s+{[^}]+};?/g, "");

    // Remove type exports
    processedInput = processedInput.replace(/export\s+type\s+[^;]+;/g, "");
    processedInput = processedInput.replace(
      /export\s+interface\s+[^{]+{[^}]+}/g,
      ""
    );

    // Remove React imports since we're injecting React globally
    if (
      processedInput.includes("import React from") ||
      processedInput.includes("import * as React from")
    ) {
      processedInput = processedInput.replace(
        /import\s+(\*\s+as\s+)?React\s+from\s+['"]react['"];?/g,
        ""
      );
    }

    const transpiledCode = transform(processedInput, {
      presets: [
        ["typescript", { isTSX: true, allExtensions: true }],
        ["react"],
      ],
      plugins: [
        createImportTransformerPlugin(
          Object.keys(dependencies),
          dependencyVarMap,
          files,
          exportInfo,
          autoResolvePackage
        ),
      ],
    }).code;

    // Store both the transpiled code and export information
    moduleCache.set(file.name, {
      code: transpiledCode,
      exportedName,
      exportInfo: fileExportInfo,
    } as any);
  });

  const entryFile = files.find((f) => f.isEntry) || files[0];
  const entryModule = moduleCache.get(entryFile.name);

  if (!entryModule) {
    throw new Error("Entry module not found");
  }

  const dependencyVars = Object.keys(dependencies)
    .map((dep) => {
      const safeName = dep.replace(/[^a-zA-Z0-9_]/g, "_");
      return `const ${safeName} = dependencies['${dep}'];`;
    })
    .join("\n      ");

  // Create the module registry
  const moduleRegistryCode = `
    const moduleCache = new Map();
    const moduleDefinitions = new Map();
  `;

  // Create module definitions with improved exports handling
  const moduleDefinitions = Array.from(moduleCache.entries())
    .map(([name, module]: [string, any]) => {
      const normalizedName = normalizeFilename(name);

      // Get export info
      const info = module.exportInfo || {
        hasDefaultExport: module.exportedName !== null,
        namedExports: new Set(),
        exportedName: module.exportedName,
      };

      // Extract all named exports directly from the code
      const namedExports = new Set<string>();

      // Check for export statements like "export const useCounter"
      const exportConstRegex =
        /export\s+(const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g;

      let hookName = null;

      // Look for direct named exports in the original code
      const originalCode = files.find((f) => f.name === name)?.content || "";
      let exportMatch;
      while ((exportMatch = exportConstRegex.exec(originalCode)) !== null) {
        namedExports.add(exportMatch[2]);
        if (name.includes("use")) {
          hookName = exportMatch[2];
          // console.log("Found named export:", exportMatch[2]);
        }
      }

      // Prepare exports handling code
      let exportsSetup = "";

      // For default exports
      if (info.hasDefaultExport && info.exportedName) {
        exportsSetup += `
        // Handle default export
        exports.default = ${info.exportedName};
        // For CommonJS compatibility
        module.exports = Object.assign({}, module.exports, typeof ${info.exportedName} === 'function' 
          ? { default: ${info.exportedName} } 
          : ${info.exportedName});
      `;
      }

      // Explicitly handle named exports we found
      for (const exportName of Array.from(namedExports)) {
        exportsSetup += `
        // Handle named export: ${exportName}
        if (typeof ${exportName} !== 'undefined') {
          exports.${exportName} = ${exportName};
        }
      `;
      }

      // For hooks add explicit export handling
      if (hookName && name.includes(hookName)) {
        exportsSetup += `
        if (typeof ${hookName} !== 'undefined') {
          exports.${hookName} = ${hookName};
        }
      `;
      }

      return `
      moduleDefinitions.set("${normalizedName}", function(React) {
        const module = { exports: {} };
        const exports = module.exports;
        
        try {
          (function(module, exports) {
            ${module.code}
            
            ${exportsSetup}
          })(module, exports);
        } catch (error) {
          console.error("Error in module ${normalizedName}:", error);
          throw error;
        }
        
        return module.exports;
      });
    `;
    })
    .join("\n\n");

  // Create module getter with better caching
  const moduleGetterCode = `
    function getModule(name) {
      if (!moduleCache.has(name)) {
        const moduleFactory = moduleDefinitions.get(name);
        if (!moduleFactory) {
          throw new Error(\`Module "\${name}" not found\`);
        }
        try {
          const moduleExports = moduleFactory(React);
          // Ensure we're getting a proper object with exports
          if (typeof moduleExports !== 'object' && typeof moduleExports !== 'function') {
            throw new Error(\`Module "\${name}" did not return a valid exports object\`);
          }
          moduleCache.set(name, moduleExports);
        } catch (error) {
          console.error(\`Error initializing module "\${name}"\`, error);
          throw error;
        }
      }
      return moduleCache.get(name);
    }
  `;

  const entryModuleName = normalizeFilename(entryFile.name);

  return `
    return function(React, dependencies) {
      // Verify that React has all the necessary hooks and components
      if (!React.useState || !React.useEffect || !React.useMemo || !React.useCallback || !React.useRef) {
        console.warn("React object is missing hooks. This may cause issues with hook usage in components.");
      }
      
      ${dependencyVars}
      
      ${moduleRegistryCode}
      
      ${moduleDefinitions}
      
      ${moduleGetterCode}

      try {
        const entryModule = getModule("${entryModuleName}");
        // More robust handling of the component export
        const Component = entryModule.default || entryModule;
        
        // Validate that we're returning a valid component
        if (typeof Component !== 'function') {
          throw new Error(\`Expected a React component but got \${typeof Component} (\${JSON.stringify(Component)}). Check that your component is properly exported.\`);
        }
        
        return Component;
      } catch (err) {
        console.error("Error loading component:", err);
        // Return a fallback component that displays the error
        return function ErrorComponent() {
          return React.createElement('div', {
            style: {
              color: 'red',
              padding: '1rem',
              border: '1px solid red',
              borderRadius: '0.25rem'
            }
          }, [
            React.createElement('h3', { key: 'title' }, 'Error Loading Component'),
            React.createElement('pre', { key: 'error' }, String(err.message || err)),
            React.createElement('div', { key: 'stack', style: { marginTop: '1rem' } }, 
              React.createElement('details', {}, [
                React.createElement('summary', { key: 'summary' }, 'Stack Trace'),
                React.createElement('pre', { key: 'trace', style: { fontSize: '0.8rem', whiteSpace: 'pre-wrap' } }, err.stack || 'No stack trace available')
              ])
            )
          ]);
        };
      }
    }
  `;
};

const normalizeFilename = (filename: string) => {
  // Remove all file extensions (.js, .jsx, .ts, .tsx)
  return filename.replace(/\.(js|jsx|ts|tsx)$/, "").replace(/^\.\//, "");
};

const createImportTransformerPlugin = (
  allowedDependencies: string[],
  dependencyVarMap: Map<string, string>,
  localModules: CodeFile[],
  exportInfo: Map<
    string,
    {
      hasDefaultExport: boolean;
      namedExports: Set<string>;
      exportedName: string | null;
    }
  > = new Map(),
  autoResolvePackage: boolean = true
) => {
  // Normalize paths for easier lookup
  const normalizedModulePaths = new Map<string, string>();

  localModules.forEach((module) => {
    const normalizedPath = normalizeFilename(module.name);
    normalizedModulePaths.set(normalizedPath, module.name);
  });

  return () => ({
    name: "import-transformer",
    visitor: {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers;

        if (specifiers.length === 0) return;

        // Special case for React imports
        if (source === "react") {
          const newNodes: t.Statement[] = [];

          // Process each React import specifier
          specifiers.forEach((specifier) => {
            // Skip the default import (React itself) as it's already available
            if (t.isImportDefaultSpecifier(specifier)) {
              // No need to do anything as React is already in scope
            } else if (t.isImportSpecifier(specifier)) {
              // For named imports like useState, useEffect, etc.
              const imported = specifier.imported;
              const importedName = t.isIdentifier(imported)
                ? imported.name
                : t.isStringLiteral(imported)
                ? imported.value
                : null;

              if (importedName !== null) {
                // Create a variable declaration to pull the named export from React
                newNodes.push(
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      t.identifier(specifier.local.name),
                      t.memberExpression(
                        t.identifier("React"),
                        t.identifier(importedName)
                      )
                    ),
                  ])
                );
              }
            }
          });

          // Replace the import declaration with our new variable declarations
          if (newNodes.length > 0) {
            path.replaceWithMultiple(newNodes);
          } else {
            path.remove();
          }
          return;
        }

        const normalizedSource = normalizeFilename(source);
        const isLocalModule = normalizedModulePaths.has(normalizedSource);

        // Check if this is a dependency (provided or to be auto-resolved)
        const isProvidedDependency = allowedDependencies.includes(source);
        const isExternalDependency = !isLocalModule && source !== "react";

        if (isExternalDependency && !isProvidedDependency) {
          if (autoResolvePackage) {
            // Don't throw immediately - let the CDN resolver handle it
            // The dependency will be resolved asynchronously in CodeExecutor
            // Add it to the dependency map so it gets transformed correctly
            const safeName = source.replace(/[^a-zA-Z0-9_]/g, "_");
            dependencyVarMap.set(source, safeName);
            console.warn(`Module ${source} not found in dependencies. Will attempt to resolve from CDN.`);
          } else {
            throw new Error(`Module not found: ${source}. To enable automatic CDN resolution, set autoResolvePackage to true.`);
          }
        }

        let newNodes: t.Statement[] = [];

        if (isLocalModule) {
          const originalModuleName =
            normalizedModulePaths.get(normalizedSource) || "";
          const moduleExportInfo = exportInfo.get(originalModuleName);

          specifiers.forEach((specifier) => {
            if (t.isImportDefaultSpecifier(specifier)) {
              // For default imports, get the module and use its default export
              newNodes.push(
                t.variableDeclaration("const", [
                  t.variableDeclarator(
                    t.identifier(specifier.local.name),
                    t.memberExpression(
                      t.callExpression(t.identifier("getModule"), [
                        t.stringLiteral(normalizedSource),
                      ]),
                      t.identifier("default")
                    )
                  ),
                ])
              );
            } else if (t.isImportSpecifier(specifier)) {
              const imported = specifier.imported;
              const importedName = t.isIdentifier(imported)
                ? imported.name
                : t.isStringLiteral(imported)
                ? imported.value
                : null;

              if (importedName !== null) {
                // Check if this is a named export from the module
                const isNamedExport =
                  moduleExportInfo &&
                  moduleExportInfo.namedExports.has(importedName);

                // Create appropriate access to the module export
                newNodes.push(
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      t.identifier(specifier.local.name),
                      t.memberExpression(
                        t.callExpression(t.identifier("getModule"), [
                          t.stringLiteral(normalizedSource),
                        ]),
                        t.identifier(importedName)
                      )
                    ),
                  ])
                );

                // Add debug comment for easier troubleshooting
                if (!isNamedExport) {
                  console.warn(
                    `Warning: Importing '${importedName}' from '${source}' but it may not be exported`
                  );
                }
              }
            }
          });
        } else {
          const sourceVarName = dependencyVarMap.get(source) || source;

          specifiers.forEach((specifier) => {
            if (t.isImportDefaultSpecifier(specifier)) {
              newNodes.push(
                t.variableDeclaration("const", [
                  t.variableDeclarator(
                    t.identifier(specifier.local.name),
                    t.identifier(sourceVarName)
                  ),
                ])
              );
            } else if (t.isImportSpecifier(specifier)) {
              const imported = specifier.imported;
              const importedName = t.isIdentifier(imported)
                ? imported.name
                : t.isStringLiteral(imported)
                ? imported.value
                : null;

              if (importedName !== null) {
                newNodes.push(
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      t.identifier(specifier.local.name),
                      t.memberExpression(
                        t.identifier(sourceVarName),
                        t.identifier(importedName)
                      )
                    ),
                  ])
                );
              }
            }
          });
        }

        path.replaceWithMultiple(newNodes);
      },

      // Handle TypeScript import types (remove them)
      TSImportType(path: { remove: () => void }) {
        path.remove();
      },

      // Handle TypeScript export declarations
      ExportNamedDeclaration(path: {
        node: { declaration: any; specifiers: string | any[] };
        replaceWith: (arg0: any) => void;
        remove: () => void;
      }) {
        // For named exports, we need to keep the declaration but remove the export
        const declaration = path.node.declaration;

        if (declaration) {
          // Replace the export declaration with just the declaration
          path.replaceWith(declaration);
        } else if (path.node.specifiers.length > 0) {
          // For export { name } from 'module' style exports
          path.remove();
        }
      },

      ExportDefaultDeclaration(path: {
        node: { declaration: any };
        remove: () => void;
        replaceWith: (arg0: t.FunctionDeclaration) => void;
      }) {
        const declaration = path.node.declaration;

        if (t.isIdentifier(declaration)) {
          // For: export default ComponentName;
          path.remove();
        } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
          // For: export default function ComponentName() {}
          path.replaceWith(declaration);
        } else {
          // For anonymous declarations: export default function() {}
          // Convert to a variable declaration
          path.remove();
        }
      },

      // Remove all type-only exports
      TSTypeAliasDeclaration(path: {
        parent: t.Node | null | undefined;
        parentPath: { remove: () => void };
      }) {
        if (path.parent && t.isExportNamedDeclaration(path.parent)) {
          path.parentPath.remove();
        }
      },

      TSInterfaceDeclaration(path: {
        parent: t.Node | null | undefined;
        parentPath: { remove: () => void };
      }) {
        if (path.parent && t.isExportNamedDeclaration(path.parent)) {
          path.parentPath.remove();
        }
      },
    },
  });
};

export const removeDefaultExport = (
  input: string
): { modifiedInput: string; exportedName: string | null } => {
  const defaultExportWithDeclarationRegex =
    /export\s+default\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]*\s*)?\s*{[^}]*}/;
  const defaultExportRegex = /export\s+default\s+([A-Za-z0-9_]+)(?:<[^>]*>)?;?/;
  const typeExportRegex = /export\s+type\s+[^;]+;/g;
  const interfaceExportRegex = /export\s+interface\s+[^{]+{[^}]+}/g;

  let match = input.match(defaultExportWithDeclarationRegex);
  let exportedName: string | null = null;
  let modifiedInput = input
    .replace(typeExportRegex, "")
    .replace(interfaceExportRegex, "");

  if (match) {
    exportedName = match[1];
    modifiedInput = modifiedInput
      .replace(/export\s+default\s+(?:async\s+)?function/, "function")
      .trim();
  } else {
    match = input.match(defaultExportRegex);
    if (match) {
      exportedName = match[1];
      modifiedInput = modifiedInput.replace(defaultExportRegex, "").trim();
    }
  }

  return { modifiedInput, exportedName };
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
