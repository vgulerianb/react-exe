/**
 * CDN Package Resolver
 * Automatically fetches packages from esm.sh CDN when dependencies are not provided
 *
 * esm.sh is a fast, global content delivery network for ES modules.
 * It automatically handles:
 * - Module format conversion (ESM, CJS, UMD)
 * - TypeScript compilation
 * - Dependency resolution
 * - React externalization (uses parent app's React)
 */

type ModulePromise = Promise<any>;

const GLOBAL_CDN_CACHE = new Map<string, ModulePromise>();
const SANDBOX_CDN_CACHE = new Map<Window, Map<string, ModulePromise>>();

/**
 * Get the current React version to use for externalization
 */
function getReactVersion(): string {
  // Try to detect React version from the global React object
  try {
    const React = (window as any).React;
    if (React && React.version) {
      return React.version;
    }
  } catch (e) {
    // Ignore
  }
  // Default to a recent stable version
  return "18";
}

/**
 * Resolves a package from esm.sh CDN with React externalization
 *
 * For packages that depend on React, we use esm.sh's external parameter
 * to ensure they use the parent app's React instance instead of bundling their own.
 *
 * @param packageName - The npm package name to resolve
 * @returns Promise resolving to the loaded module
 */
export async function resolvePackageFromCDN(
  packageName: string,
  targetWindow?: Window | null
): Promise<any> {
  const cache = getCache(targetWindow);
  if (cache.has(packageName)) {
    return cache.get(packageName)!;
  }

  // Create a promise that resolves the package
  const resolvePromise = (async () => {
    try {
      console.log(`Resolving ${packageName} from esm.sh CDN...`);

      // Get React version for externalization
      const reactVersion = getReactVersion();

      // Build the esm.sh URL with React externalization
      // This tells esm.sh to NOT bundle React, so the package will use our React instance
      const cdnUrl = `https://esm.sh/${packageName}?external=react,react-dom&target=es2022&dev`;

      // Use dynamic import to load the module
      const module = await importModuleFromUrl(cdnUrl, targetWindow);

      console.log(`✅ Successfully resolved ${packageName} from CDN`);

      // Return the entire module object (which includes both default and named exports)
      return module;
    } catch (error) {
      console.error(`❌ Failed to load ${packageName} from esm.sh:`, error);

      // Try a fallback with unpkg for simpler packages
      try {
        console.log(`Trying fallback CDN for ${packageName}...`);
        const fallbackUrl = `https://cdn.jsdelivr.net/npm/${packageName}/+esm`;
        const module = await importModuleFromUrl(fallbackUrl, targetWindow);
        console.log(
          `✅ Successfully resolved ${packageName} from jsDelivr fallback`
        );
        return module;
      } catch (fallbackError) {
        throw new Error(
          `Failed to resolve ${packageName} from CDN. ` +
            `Primary error: ${
              error instanceof Error ? error.message : String(error)
            }. ` +
            `Fallback error: ${
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError)
            }`
        );
      }
    }
  })();

  // Cache the promise
  cache.set(packageName, resolvePromise);

  return resolvePromise;
}

/**
 * Clears the CDN cache
 */
export function clearCDNCache(): void {
  GLOBAL_CDN_CACHE.clear();
  SANDBOX_CDN_CACHE.forEach((cache) => cache.clear());
  SANDBOX_CDN_CACHE.clear();
}

/**
 * Pre-loads a package into the cache
 * Useful for preloading commonly used packages
 */
export async function preloadPackage(
  packageName: string,
  targetWindow?: Window | null
): Promise<void> {
  await resolvePackageFromCDN(packageName, targetWindow);
}

function getCache(targetWindow?: Window | null) {
  if (!targetWindow || targetWindow === window) {
    return GLOBAL_CDN_CACHE;
  }

  if (!SANDBOX_CDN_CACHE.has(targetWindow)) {
    SANDBOX_CDN_CACHE.set(targetWindow, new Map());
  }

  return SANDBOX_CDN_CACHE.get(targetWindow)!;
}

async function importModuleFromUrl(url: string, targetWindow?: Window | null) {
  if (!targetWindow || targetWindow === window) {
    return import(/* @vite-ignore */ url);
  }

  return importInsideWindow(url, targetWindow);
}

function importInsideWindow(url: string, targetWindow: Window): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const doc = targetWindow.document;
      if (!doc) {
        reject(new Error("Sandbox document is not accessible"));
        return;
      }

      const globalVar = `__reactExeModule__${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;
      const script = doc.createElement("script");
      script.type = "module";
      const safeUrl = JSON.stringify(url);
      script.textContent = `
        import * as Module from ${safeUrl};
        window.${globalVar} = Module;
      `;

      const cleanup = () => {
        try {
          delete (targetWindow as any)[globalVar];
        } catch {
          // ignore
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };

      script.addEventListener("load", () => {
        const moduleExports = (targetWindow as any)[globalVar];
        cleanup();
        if (!moduleExports) {
          reject(
            new Error(`Module ${url} was loaded but no exports were captured`)
          );
          return;
        }
        resolve(moduleExports);
      });

      script.addEventListener("error", (event) => {
        cleanup();
        reject(
          new Error(
            `Failed to load ${url} inside sandbox: ${
              (event as ErrorEvent).message || "unknown error"
            }`
          )
        );
      });

      doc.head.appendChild(script);
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error(`Failed to import ${url} inside sandbox`)
      );
    }
  });
}
