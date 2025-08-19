import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import terser from "@rollup/plugin-terser";

const processPolyfill = `
const process = {
  env: {
    NODE_ENV: 'production'
  }
};
`;

export default {
  input: "src/index.tsx",
  output: [
    {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: false,
      exports: "named",
      interop: "auto",
      banner: processPolyfill
    },
    {
      file: "dist/index.js",
      format: "cjs",
      sourcemap: false,
      exports: "named",
      interop: "auto",
      banner: processPolyfill
    }
  ],
  plugins: [
    peerDepsExternal(),
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs({
      requireReturnsDefault: "auto",
      dynamicRequireTargets: ["node_modules/@babel/standalone/**/*.js"],
      transformMixedEsModules: true
    }),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: true,
      declarationDir: "dist",
    }),
    terser(),
  ],
  external: ["react", "react-dom"]
};
