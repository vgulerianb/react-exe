import type { CodeFile, CodeExecutorConfig } from "react-exe";

export interface Scenario {
  id: string;
  title: string;
  code: string | CodeFile[];
  config?: CodeExecutorConfig;
  /** Text the rendered preview must contain for the scenario to pass. */
  expect: string;
}

export const scenarios: Scenario[] = [
  {
    id: "counter",
    title: "Counter (useState)",
    expect: "Count: 0",
    code: `import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}`,
  },
  {
    id: "tailwind",
    title: "Tailwind CSS",
    expect: "Styled with Tailwind",
    config: { enableTailwind: true },
    code: `export default function Card() {
  return <div className="p-4 m-2 rounded-lg bg-indigo-600 text-white font-bold">Styled with Tailwind</div>;
}`,
  },
  {
    id: "cdn-date-fns",
    title: "CDN auto-resolve (date-fns)",
    expect: "date-fns resolved from CDN automatically",
    code: `import { format, addDays } from 'date-fns';

export default function DateCalc() {
  const [offset, setOffset] = React.useState(7);
  const today = new Date();
  const target = addDays(today, offset);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <p>date-fns resolved from CDN automatically</p>
      <p>Today: {format(today, "MMMM do, yyyy")}</p>
      <p>+{offset} days: {format(target, "MMMM do, yyyy")}</p>
      <input type="range" min={0} max={60} value={offset} onChange={(e) => setOffset(+e.target.value)} />
    </div>
  );
}`,
  },
  {
    id: "cdn-react-libs",
    title: "CDN React libs (lucide + framer-motion)",
    expect: "Animated with framer-motion",
    code: `import {
  Heart,
  Star,
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function Icons() {
  const [liked, setLiked] = React.useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 16 }}>
      <p>Animated with framer-motion</p>
      <button onClick={() => setLiked(!liked)}>
        <Heart fill={liked ? "red" : "none"} /> <Star />
      </button>
    </motion.div>
  );
}`,
  },
  {
    id: "cdn-interop",
    title: "CDN default + namespace imports",
    expect: "chunks: 3 | confetti: function",
    code: `import confetti from 'canvas-confetti';
import * as _ from 'lodash-es';

export default function Interop() {
  return <p>chunks: {_.chunk([1, 2, 3, 4, 5], 2).length} | confetti: {typeof confetti}</p>;
}`,
  },
  {
    id: "cdn-css-pinned",
    title: "CDN package CSS + pinned version",
    expect: "Toast from 2020",
    code: `import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { format } from 'date-fns@3';

export default function Toasts() {
  React.useEffect(() => {
    toast('Toast from ' + format(new Date(2020, 0, 1), 'yyyy'), { autoClose: false });
  }, []);
  return <ToastContainer position="bottom-left" />;
}`,
  },
  {
    id: "multi-file",
    title: "Multi-file (default + named + hook)",
    expect: "Clicked 0 times",
    code: [
      {
        name: "App.tsx",
        isEntry: true,
        content: `import Button from './components/Button';
import { useCounter } from './hooks/useCounter';

export default function App() {
  const { count, increment } = useCounter();
  return <Button label={\`Clicked \${count} times\`} onClick={increment} />;
}`,
      },
      {
        name: "components/Button.tsx",
        content: `interface ButtonProps { label: string; onClick: () => void }
export default function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}`,
      },
      {
        name: "hooks/useCounter.ts",
        content: `import { useState } from 'react';
export const useCounter = (initial = 0) => {
  const [count, setCount] = useState(initial);
  return { count, increment: () => setCount((c) => c + 1) };
};`,
      },
    ],
  },
  {
    id: "class-component",
    title: "Class component default export",
    expect: "Class says hi",
    code: `import React from 'react';

export default class Greeting extends React.Component<{}, { name: string }> {
  state = { name: "Class" };
  render() {
    return <p>{this.state.name} says hi</p>;
  }
}`,
  },
  {
    id: "memo-export",
    title: "export default memo(...)",
    expect: "Memoized component",
    code: `import { memo } from 'react';

const Inner = () => <p>Memoized component</p>;
export default memo(Inner);`,
  },
  {
    id: "wildcard-deps",
    title: "Wildcard dependency (@/components/ui/*)",
    expect: "UI kit button",
    config: {
      dependencies: {
        "@/components/ui/*": {
          Button: (props: { children?: unknown }) => props.children as never,
        },
      },
    },
    code: `import { Button } from "@/components/ui/button";

export default function App() {
  return <Button>UI kit button</Button>;
}`,
  },
  {
    id: "runtime-error",
    title: "Runtime error surfaces",
    expect: "Boom from render",
    code: `export default function Broken() {
  throw new Error("Boom from render");
}`,
  },
];
