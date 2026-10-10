import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";

/** Unwraps a bundler namespace object (`import * as X`) to the module's exports. */
const unwrap = (namespace: any) =>
  namespace && typeof namespace.default === "object" && namespace.default
    ? namespace.default
    : namespace;

const jsxRuntime = unwrap(JSXRuntime);

/**
 * The host app's React modules. Executed code and CDN packages are wired to
 * these so everything shares a single React instance (two copies of React
 * break hooks and context).
 */
export const HOST_MODULES: Record<string, any> = {
  react: React,
  "react-dom": unwrap(ReactDOM),
  "react-dom/client": unwrap(ReactDOMClient),
  "react/jsx-runtime": jsxRuntime,
  // Development builds of CDN packages import jsxDEV; map it onto jsx/jsxs.
  "react/jsx-dev-runtime": {
    Fragment: jsxRuntime.Fragment,
    jsxDEV: (type: any, props: any, key: any, isStaticChildren?: boolean) =>
      (isStaticChildren ? jsxRuntime.jsxs : jsxRuntime.jsx)(type, props, key),
  },
};
