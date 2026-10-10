import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodeFile } from "../src/types";
import { compileProject } from "../src/utils/compiler";
import {
  findMissingPackages,
  getEntryComponent,
  instantiateProject,
} from "../src/utils/runtime";

const run = (
  code: string | CodeFile[],
  dependencies: Record<string, any> = {},
  packages: Record<string, any> = {}
) => {
  const files = typeof code === "string" ? [{ name: "App.tsx", content: code }] : code;
  const project = compileProject(files);
  const { exports } = instantiateProject(project, { React, dependencies, packages });
  const Component = getEntryComponent(exports, "App.tsx", React);
  return renderToStaticMarkup(React.createElement(Component));
};

/** Mimics a native ES module namespace object (what `import()` returns). */
const namespace = (exports: Record<string, any>) =>
  Object.freeze(
    Object.assign(Object.create(null), exports, { [Symbol.toStringTag]: "Module" })
  );

describe("single file", () => {
  it("renders a default-exported function using React without importing it", () => {
    expect(
      run(`export default function App() {
        const [n] = React.useState(2);
        return <p>{n}</p>;
      }`)
    ).toBe("<p>2</p>");
  });

  it("supports named React imports, fragments and TypeScript", () => {
    expect(
      run(`import { useState, Fragment } from 'react';
      interface Props { label?: string }
      export default function App({ label = "hi" }: Props) {
        const [items] = useState<string[]>(["a", "b"]);
        return <>{items.map((i) => <Fragment key={i}>{label}{i}</Fragment>)}</>;
      }`)
    ).toBe("hiahib");
  });

  it("supports class components", () => {
    expect(
      run(`import React from 'react';
      export default class App extends React.Component<{}, { n: number }> {
        state = { n: 3 };
        render() { return <b>{this.state.n}</b>; }
      }`)
    ).toBe("<b>3</b>");
  });

  it("supports memo, anonymous arrows and default-exported elements", () => {
    expect(run(`import { memo } from 'react';\nexport default memo(() => <i>m</i>);`)).toBe("<i>m</i>");
    expect(run(`export default () => <i>arrow</i>;`)).toBe("<i>arrow</i>");
    expect(run(`export default <i>element</i>;`)).toBe("<i>element</i>");
  });

  it("falls back to a single named component export", () => {
    expect(run(`export const helper = 1;\nexport function Widget() { return <i>w</i>; }`)).toBe("<i>w</i>");
  });

  it("reports a missing component export", () => {
    expect(() => run(`export const value = 1;`)).toThrow(/must default-export a React component/);
  });

  it("names the file in syntax errors", () => {
    expect(() => run(`export default function App() { return <div> }`)).toThrow(/App\.tsx/);
  });
});

describe("multiple files", () => {
  it("resolves default, named, namespace and re-exported imports", () => {
    const html = run([
      {
        name: "App.tsx",
        isEntry: true,
        content: `import Button, { Label } from './components/Button';
        import * as utils from './utils';
        import { double } from './lib';
        import config from './config.json';
        export default function App() {
          return <Button><Label text={utils.shout(config.name)} />{double(2)}</Button>;
        }`,
      },
      {
        name: "components/Button.tsx",
        content: `export const Label = ({ text }: { text: string }) => <span>{text}</span>;
        export default function Button({ children }: { children: React.ReactNode }) {
          return <button>{children}</button>;
        }`,
      },
      { name: "utils.ts", content: `export const shout = (s: string) => s.toUpperCase();` },
      { name: "lib/index.ts", content: `export * from './math';` },
      { name: "lib/math.ts", content: `export const double = (n: number) => n * 2;` },
      { name: "config.json", content: `{ "name": "exe" }` },
    ]);
    expect(html).toBe("<button><span>EXE</span>4</button>");
  });

  it("resolves @/ aliases and parent-relative paths", () => {
    const html = run([
      {
        name: "App.tsx",
        isEntry: true,
        content: `import { Card } from '@/components/Card';\nexport default () => <Card />;`,
      },
      {
        name: "components/Card.tsx",
        content: `import { title } from '../data/title';\nexport const Card = () => <h1>{title}</h1>;`,
      },
      { name: "data/title.ts", content: `export const title = "card";` },
    ]);
    expect(html).toBe("<h1>card</h1>");
  });

  it("handles circular imports", () => {
    const html = run([
      {
        name: "App.tsx",
        isEntry: true,
        content: `import { a } from './a';\nexport default () => <p>{a()}</p>;`,
      },
      { name: "a.ts", content: `import { b } from './b';\nexport const a = () => 'a' + b();\nexport const leaf = () => '!';` },
      { name: "b.ts", content: `import { leaf } from './a';\nexport const b = () => 'b' + leaf();` },
    ]);
    expect(html).toBe("<p>ab!</p>");
  });
});

describe("dependencies", () => {
  it("supports exact and wildcard dependency keys", () => {
    const Button = ({ children }: any) => React.createElement("button", null, children);
    expect(
      run(
        `import { Button } from '@/components/ui/button';
        import greet from 'greeter';
        export default () => <Button>{greet()}</Button>;`,
        { "@/components/ui/*": { Button }, greeter: () => "hey" }
      )
    ).toBe("<button>hey</button>");
  });

  it("interops with ES module namespaces", () => {
    const html = run(
      `import confetti from 'canvas-confetti';
      import * as _ from 'lodash-es';
      import chunkDefault, { chunk } from 'lodash-es';
      export default () => <p>{confetti()} {_.chunk.name} {chunk === chunkDefault.chunk ? 'same' : 'diff'}</p>;`,
      {},
      {
        "canvas-confetti": namespace({ default: () => "boom" }),
        // No default export: a default import falls back to the namespace.
        "lodash-es": namespace({ chunk: function chunk() {} }),
      }
    );
    expect(html).toBe("<p>boom chunk same</p>");
  });

  it("throws a helpful error for unknown modules", () => {
    expect(() => run(`import x from 'nope';\nexport default () => x;`)).toThrow(
      /Module not found: "nope" \(imported from App\.tsx\)/
    );
  });
});

describe("findMissingPackages", () => {
  it("lists only packages that must come from the CDN", () => {
    const project = compileProject([
      {
        name: "App.tsx",
        isEntry: true,
        content: `import {
          format,
        } from 'date-fns';
        import type { Foo } from 'types-only';
        import { OnlyAType } from 'elided-by-typescript';
        import 'some-lib/styles.css';
        import { useState } from 'react';
        import { createPortal } from 'react-dom';
        import { Button } from '@/components/ui/button';
        import provided from 'provided';
        import { local } from './local';
        export { motion } from 'framer-motion';
        const x: OnlyAType = null as any;
        export default () => format(new Date(), 'yyyy') + local + provided + Button + useState + createPortal;`,
      },
      { name: "local.ts", content: `export const local = 1;` },
    ]);
    expect(
      findMissingPackages(project, { provided: 1, "@/components/ui/*": {} }).sort()
    ).toEqual(["date-fns", "framer-motion", "some-lib/styles.css"]);
  });
});
