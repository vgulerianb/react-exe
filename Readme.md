# React-EXE

Execute React components on the fly with external dependencies, custom styling, and TypeScript support. Perfect for creating live code previews, documentation, or interactive code playgrounds.

<img width="1512" alt="Screenshot 2025-02-26 at 00 23 34" src="https://github.com/user-attachments/assets/bc690e07-3b7a-4719-8547-f21e08f50b65" />

Try the live demo [here](https://slaps.dev/react-exe).

## Features

- 🚀 Execute React components from string code
- 📦 Support for external dependencies
- 🎨 Tailwind CSS support
- 🔒 Built-in security checks
- 💅 Customizable styling
- 📝 TypeScript support
- ⚡ Live rendering
- 🐛 Error boundary protection
- 📄 Multi-file support

## Installation

```bash
npm install react-exe
# or
yarn add react-exe
# or
pnpm add react-exe
```

## Vite Configuration

If you're using Vite, you need to add the following configuration to your `vite.config.js` or `vite.config.ts`:

```js
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env": {},
  },
  // ... rest of your config
});
```

This is required to ensure proper functionality in Vite projects.

## Basic Usage

```tsx
import { CodeExecutor } from "react-exe";

const code = `
export default function HelloWorld() {
  return (
    <div className="p-4 bg-blue-100 rounded">
      <h1 className="text-2xl font-bold">Hello World!</h1>
    </div>
  );
}
`;

function App() {
  return <CodeExecutor code={code} config={{ enableTailwind: true }} />;
}
```

## Advanced Usage

### With External Dependencies

```tsx
import { CodeExecutor } from "react-exe";
import * as echarts from "echarts";
import * as framerMotion from "framer-motion";

const code = `
import { motion } from 'framer-motion';
import { LineChart } from 'echarts';

export default function Dashboard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-4"
    >
      <LineChart 
        option={{
          xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
          yAxis: { type: 'value' },
          series: [{ data: [150, 230, 224], type: 'line' }]
        }}
        style={{ height: '300px' }}
      />
    </motion.div>
  );
}
`;

function App() {
  return (
    <CodeExecutor
      code={code}
      config={{
        dependencies: {
          "framer-motion": framerMotion,
          echarts: echarts,
        },
        enableTailwind: true,
        containerClassName: "min-h-[400px]",
        containerStyle: {
          padding: "20px",
          background: "#f9fafb",
        },
      }}
    />
  );
}
```

### Automatic Package Resolution from CDN

By default, `react-exe` automatically resolves missing packages from CDN (jsDelivr or unpkg). This means you don't need to manually provide all dependencies:

```tsx
import { CodeExecutor } from "react-exe";

const code = `
import { useState } from 'react';
import { motion } from 'framer-motion';
import * as echarts from 'echarts';

export default function Dashboard() {
  const [count, setCount] = useState(0);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6"
    >
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </motion.div>
  );
}
`;

function App() {
  return (
    <CodeExecutor
      code={code}
      config={{
        enableTailwind: true,
        // autoResolvePackage defaults to true, so framer-motion will be
        // automatically fetched from CDN if not provided
      }}
    />
  );
}
```

**How it works:**

- When a package is imported but not provided in `dependencies`, `react-exe` automatically attempts to fetch it from [jsDelivr](https://www.jsdelivr.com/) CDN
- If jsDelivr fails, it falls back to [unpkg](https://unpkg.com/)
- Packages are cached to avoid redundant network requests
- A loading indicator is shown while dependencies are being resolved

**Disable automatic resolution:**

If you want to disable automatic package resolution and require all dependencies to be provided manually:

```tsx
<CodeExecutor
  code={code}
  config={{
    autoResolvePackage: false, // Disable automatic CDN resolution
    dependencies: {
      // All dependencies must be provided manually
      "framer-motion": framerMotion,
    },
  }}
/>
```

**Note:** Automatic resolution works best with packages that support ES modules. Some packages may require manual configuration.

**Package Compatibility Guide:**

The auto-resolution feature works best with different types of packages:

✅ **Works Great** (Recommended for auto-resolution):

- **Utility libraries**: `date-fns`, `lodash-es`, `ramda`, `validator`, `uuid`
- **Formatting**: `numeral`, `dayjs`, `luxon`, `currency.js`
- **Simple React components**: `react-icons`, `react-syntax-highlighter`
- **Data visualization**: `recharts`, `victory` (when using manual React)
- **Math/Logic**: `mathjs`, `big.js`, `decimal.js`

⚠️ **May Require Manual Setup**:

- **Complex React libraries**: `framer-motion`, `react-spring` (better to provide manually due to React context requirements)
- **CSS-in-JS**: `@emotion/styled`, `styled-components` (may need configuration)
- **UI frameworks**: `@mui/material`, `antd` (large dependencies, better to provide manually)

❌ **Won't Work** (Browser limitations):

- **Node.js-specific**: `fs`, `path`, `crypto`, `process` (not available in browser)
- **Build-time only**: `@svgr/webpack`, bundler plugins
- **Native modules**: Packages with `.node` bindings

**Best Practice**: For production apps, manually provide critical dependencies for better control and faster load times. Use auto-resolution for quick prototyping or simple utilities.

## Sandboxed Execution (Default)

React-EXE renders user code inside a sandboxed iframe by default. This keeps previews isolated from your application DOM and prevents malicious scripts from mutating global state.

```tsx
import { CodeExecutor } from "react-exe";

function App() {
  return (
    <CodeExecutor
      code={`export default function Demo() { return <div>Sandboxed output</div>; }`}
      config={{
        sandbox: true, // Default
        enableTailwind: true,
      }}
    />
  );
}
```

**Sandbox benefits**

- Independent DOM tree and CSS scope per preview
- Prevents access to the parent `document`/`window`
- Works with automatic CDN dependency resolution
- Tailwind is loaded inside the iframe when enabled

### Disabling the Sandbox

Disable sandbox mode only when you trust the code and require full access to the parent context (for example, to share in-memory objects or DOM nodes).

```tsx
<CodeExecutor
  code={code}
  config={{
    sandbox: false, // Runs directly in the parent document
    dependencies: {
      echarts,
      "framer-motion": motion,
    },
  }}
/>
```

⚠️ **Warning:** When `sandbox` is `false`, executed code runs alongside your app and can read or mutate the parent DOM/window.

### With absolute imports and wildcard patterns

```tsx
import { CodeExecutor } from "react-exe";
import * as echarts from "echarts";
import * as framerMotion from "framer-motion";
import * as uiComponents from "../ShadcnComps";

const code = `
import { motion } from 'framer-motion';
import { LineChart } from 'echarts';
import { Button } from "@/components/ui/button"

export default function Dashboard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-4"
    >
      <LineChart 
        option={{
          xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
          yAxis: { type: 'value' },
          series: [{ data: [150, 230, 224], type: 'line' }]
        }}
        style={{ height: '300px' }}
      />
    </motion.div>
  );
}
`;

function App() {
  return (
    <CodeExecutor
      code={code}
      config={{
        dependencies: {
          "framer-motion": framerMotion,
          echarts: echarts,
          "@/components/ui/*": uiComponents,
        },
        enableTailwind: true,
        containerClassName: "min-h-[400px]",
        containerStyle: {
          padding: "20px",
          background: "#f9fafb",
        },
      }}
    />
  );
}
```

### With Multiple Files

React-EXE supports multiple files with cross-imports, allowing you to build more complex components and applications:

```tsx
import { CodeExecutor } from "react-exe";
import * as framerMotion from "framer-motion";

// Define multiple files as an array of code files
const files = [
  {
    name: "App.tsx", // Main entry file
    content: `
import React from 'react';
import { motion } from 'framer-motion';
import Header from './Header';
import Counter from './Counter';

const App = () => {
  return (
    <motion.div 
      className="min-h-screen bg-gray-100 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Multi-File App Example" />
      <Counter />
    </motion.div>
  );
};

export default App;
    `,
    isEntry: true, // Mark this as the entry point
  },
  {
    name: "Header.tsx",
    content: `
import React from 'react';

interface HeaderProps {
  title: string;
}

const Header = ({ title }: HeaderProps) => {
  return (
    <header className="bg-white p-4 mb-4 rounded-lg shadow-md">
      <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
    </header>
  );
};

export default Header;
    `,
  },
  {
    name: "Counter.tsx",
    content: `
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import CounterButton from './CounterButton';

const Counter = () => {
  const [count, setCount] = useState(0);
  
  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);
  
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">Counter Component</h2>
      
      <motion.div 
        className="text-center text-3xl font-bold my-4"
        key={count}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        {count}
      </motion.div>
      
      <div className="flex justify-center gap-4">
        <CounterButton onClick={decrement} label="Decrease" variant="danger" />
        <CounterButton onClick={increment} label="Increase" variant="success" />
      </div>
    </div>
  );
};

export default Counter;
    `,
  },
  {
    name: "CounterButton.tsx",
    content: `
import React from 'react';
import { motion } from 'framer-motion';

interface CounterButtonProps {
  onClick: () => void;
  label: string;
  variant?: 'primary' | 'success' | 'danger';
}

const CounterButton = ({ 
  onClick, 
  label, 
  variant = 'primary' 
}: CounterButtonProps) => {
  
  const getButtonColor = () => {
    switch(variant) {
      case 'success': return 'bg-green-500 hover:bg-green-600';
      case 'danger': return 'bg-red-500 hover:bg-red-600';
      default: return 'bg-blue-500 hover:bg-blue-600';
    }
  };
  
  return (
    <motion.button
      className={\`\${getButtonColor()} text-white py-2 px-4 rounded\`}
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {label}
    </motion.button>
  );
};

export default CounterButton;
    `,
  },
];

function App() {
  return (
    <CodeExecutor
      code={files}
      config={{
        dependencies: {
          "framer-motion": framerMotion,
        },
        enableTailwind: true,
        containerClassName: "rounded-lg overflow-hidden",
      }}
    />
  );
}
```

### Creating a Project Structure with Multiple Files

For more complex applications, you can organize your files in a project-like structure:

```tsx
import { CodeExecutor } from "react-exe";
import * as reactRouter from "react-router-dom";
import * as framerMotion from "framer-motion";

const files = [
  {
    name: "App.tsx",
    content: `
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import About from './pages/About';
import NotFound from './pages/NotFound';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
    `,
    isEntry: true,
  },
  {
    name: "components/Layout.tsx",
    content: `
import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';

const Layout = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default Layout;
    `,
  },
  {
    name: "components/Navbar.tsx",
    content: `
import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navbar = () => {
  const location = useLocation();
  
  const isActive = (path: string) => {
    return location.pathname === path ? 
      'text-white bg-indigo-700' : 
      'text-indigo-200 hover:text-white hover:bg-indigo-600';
  };
  
  return (
    <nav className="bg-indigo-800 text-white shadow-md">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="font-bold text-xl">Multi-File App</Link>
          
          <div className="flex space-x-4">
            <Link 
              to="/" 
              className={\`px-3 py-2 rounded-md \${isActive('/')}\`}
            >
              Home
            </Link>
            <Link 
              to="/about" 
              className={\`px-3 py-2 rounded-md \${isActive('/about')}\`}
            >
              About
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
    `,
  },
  {
    name: "components/Footer.tsx",
    content: `
import React from 'react';

const Footer = () => {
  return (
    <footer className="bg-gray-800 text-white py-6">
      <div className="container mx-auto px-4 text-center">
        <p>&copy; {new Date().getFullYear()} React-EXE Demo</p>
        <p className="text-gray-400 text-sm mt-1">Built with multiple files</p>
      </div>
    </footer>
  );
};

export default Footer;
    `,
  },
  {
    name: "pages/Home.tsx",
    content: `
import React from 'react';
import { motion } from 'framer-motion';

const Home = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="text-3xl font-bold mb-6">Welcome to the Home Page</h1>
      <p className="mb-4">This is a multi-file application example using React-EXE.</p>
      <p className="mb-4">
        It demonstrates how you can create complex applications with multiple
        components, pages, and even routing!
      </p>
      
      <div className="mt-8 p-6 bg-indigo-50 rounded-lg shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Features Demonstrated:</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Multiple file structure</li>
          <li>React Router integration</li>
          <li>Animation with Framer Motion</li>
          <li>Component composition</li>
          <li>Styling with Tailwind CSS</li>
        </ul>
      </div>
    </motion.div>
  );
};

export default Home;
    `,
  },
  {
    name: "pages/About.tsx",
    content: `
import React from 'react';
import { motion } from 'framer-motion';

const About = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="text-3xl font-bold mb-6">About Page</h1>
      <p className="mb-4">
        React-EXE is a powerful library for executing React components on the fly.
        It supports multi-file applications like this one!
      </p>
      
      <motion.div 
        className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4"
        variants={{
          hidden: { opacity: 0 },
          show: {
            opacity: 1,
            transition: {
              staggerChildren: 0.2
            }
          }
        }}
        initial="hidden"
        animate="show"
      >
        {[1, 2, 3].map((item) => (
          <motion.div
            key={item}
            className="bg-white p-6 rounded-lg shadow-md"
            variants={{
              hidden: { opacity: 0, y: 20 },
              show: { opacity: 1, y: 0 }
            }}
          >
            <h3 className="font-bold text-lg mb-2">Feature {item}</h3>
            <p className="text-gray-600">
              This is an example of a card that demonstrates Framer Motion animations
              in a multi-file React component.
            </p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
};

export default About;
    `,
  },
  {
    name: "pages/NotFound.tsx",
    content: `
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const NotFound = () => {
  return (
    <motion.div 
      className="text-center py-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ 
          type: "spring", 
          stiffness: 200, 
          damping: 10 
        }}
      >
        <h1 className="text-9xl font-bold text-indigo-200">404</h1>
      </motion.div>
      
      <h2 className="text-3xl font-bold mb-4">Page Not Found</h2>
      <p className="text-gray-600 mb-8">
        The page you're looking for doesn't exist or has been moved.
      </p>
      
      <Link 
        to="/" 
        className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors"
      >
        Return Home
      </Link>
    </motion.div>
  );
};

export default NotFound;
    `,
  },
];

function App() {
  return (
    <CodeExecutor
      code={files}
      config={{
        dependencies: {
          "react-router-dom": reactRouter,
          "framer-motion": framerMotion,
        },
        enableTailwind: true,
      }}
    />
  );
}
```

### Using Custom Hooks and Utilities in Multi-File Apps

You can also create and use custom hooks, utilities, and TypeScript types across multiple files:

```tsx
import { CodeExecutor } from "react-exe";

const files = [
  {
    name: "App.tsx",
    content: `
import React from 'react';
import ThemeProvider from './theme/ThemeProvider';
import ThemeSwitcher from './components/ThemeSwitcher';
import UserProfile from './components/UserProfile';
import { fetchUserData } from './utils/api';

const App = () => {
  return (
    <ThemeProvider>
      <div className="min-h-screen p-6">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-end mb-6">
            <ThemeSwitcher />
          </div>
          <UserProfile userId="1" fetchUserData={fetchUserData} />
        </div>
      </div>
    </ThemeProvider>
  );
};

export default App;
    `,
    isEntry: true,
  },
  {
    name: "types/index.ts",
    content: `
export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export type Theme = 'light' | 'dark' | 'system';

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}
    `,
  },
  {
    name: "theme/ThemeProvider.tsx",
    content: `
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Theme, ThemeContextType } from '../types';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('system');
  
  useEffect(() => {
    const applyTheme = (newTheme: Theme) => {
      const root = window.document.documentElement;
      
      // Remove any existing theme classes
      root.classList.remove('light', 'dark');
      
      // Apply the appropriate theme
      if (newTheme === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        root.classList.add(systemTheme);
      } else {
        root.classList.add(newTheme);
      }
    };
    
    applyTheme(theme);
    
    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeProvider;
    `,
  },
  {
    name: "components/ThemeSwitcher.tsx",
    content: `
import React from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { Theme } from '../types';

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  
  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: '☀️ Light' },
    { value: 'dark', label: '🌙 Dark' },
    { value: 'system', label: '🖥️ System' }
  ];
  
  return (
    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-md inline-block">
      <div className="flex space-x-2">
        {themes.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={\`px-3 py-1 rounded-md \${
              theme === value
                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }\`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSwitcher;
    `,
  },
  {
    name: "hooks/useUser.ts",
    content: `
import { useState, useEffect } from 'react';
import { User } from '../types';

export const useUser = (
  userId: string,
  fetchUserData: (id: string) => Promise<User>
) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let isMounted = true;
    
    const loadUser = async () => {
      try {
        setLoading(true);
        const userData = await fetchUserData(userId);
        
        if (isMounted) {
          setUser(userData);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load user');
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    loadUser();
    
    return () => {
      isMounted = false;
    };
  }, [userId, fetchUserData]);
  
  return { user, loading, error };
};
    `,
  },
  {
    name: "utils/api.ts",
    content: `
import { User } from '../types';

// Simulate API call with mock data
export const fetchUserData = async (userId: string): Promise<User> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Mock data
  const users: Record<string, User> = {
    '1': {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      avatar: 'https://randomuser.me/api/portraits/men/32.jpg'
    },
    '2': {
      id: '2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      avatar: 'https://randomuser.me/api/portraits/women/44.jpg'
    }
  };
  
  const user = users[userId];
  
  if (!user) {
    throw new Error(\`User with ID \${userId} not found\`);
  }
  
  return user;
};
    `,
  },
  {
    name: "components/UserProfile.tsx",
    content: `
import React from 'react';
import { useUser } from '../hooks/useUser';
import { User } from '../types';

interface UserProfileProps {
  userId: string;
  fetchUserData: (id: string) => Promise<User>;
}

const UserProfile = ({ userId, fetchUserData }: UserProfileProps) => {
  const { user, loading, error } = useUser(userId, fetchUserData);
  
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 animate-pulse">
        <div className="flex items-center space-x-4">
          <div className="rounded-full bg-gray-300 dark:bg-gray-600 h-16 w-16"></div>
          <div className="flex-1 space-y-3">
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
            <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="bg-red-100 dark:bg-red-900 border-l-4 border-red-500 text-red-700 dark:text-red-200 p-4 rounded">
        <p>{error}</p>
      </div>
    );
  }
  
  if (!user) {
    return <div>No user found</div>;
  }
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div className="p-6">
        <div className="flex items-center space-x-4">
          <img 
            src={user.avatar} 
            alt={user.name} 
            className="h-16 w-16 rounded-full border-2 border-indigo-500"
          />
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{user.name}</h2>
            <p className="text-gray-600 dark:text-gray-300">{user.email}</p>
          </div>
        </div>
      </div>
      <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          User ID: {user.id}
        </p>
      </div>
    </div>
  );
};

export default UserProfile;
    `,
  },
];

function App() {
  return (
    <CodeExecutor
      code={files}
      config={{
        enableTailwind: true,
      }}
    />
  );
}
```

### With Custom Error Handling

```tsx
import { CodeExecutor } from "react-exe";

function App() {
  return (
    <CodeExecutor
      code={code}
      config={{
        enableTailwind: true,
        errorClassName: "my-error-class",
        errorStyle: {
          background: "#fee2e2",
          border: "2px solid #ef4444",
        },
        onError: (error) => {
          console.error("Component error:", error);
          // Send to error tracking service
          trackError(error);
        },
        // Custom security patterns
        securityPatterns: [
          /localStorage/i,
          /sessionStorage/i,
          /window\.location/i,
        ],
      }}
    />
  );
}
```

## Configuration Options

The `config` prop accepts the following options:

```typescript
interface CodeExecutorConfig {
  // External dependencies available to the rendered component
  dependencies?: Record<string, any>;

  // Enable Tailwind CSS support
  enableTailwind?: boolean;

  // Automatically resolve missing packages from CDN (jsDelivr/unpkg)
  // Default: true
  autoResolvePackage?: boolean;

  // Execute code inside isolated iframe sandbox
  // Default: true
  sandbox?: boolean;

  // Custom className for the container
  containerClassName?: string;

  // Custom inline styles for the container
  containerStyle?: React.CSSProperties;

  // Custom className for error messages
  errorClassName?: string;

  // Custom inline styles for error messages
  errorStyle?: React.CSSProperties;

  // Custom security patterns to block potentially malicious code
  securityPatterns?: RegExp[];

  // Error callback function
  onError?: (error: Error) => void;
}
```

## Code Input Types

React-EXE accepts code in two formats:

1. **Single File**: Pass a string containing the React component code

   ```typescript
   // Single file as a string
   const code = `
   export default function App() {
     return <div>Hello World</div>;
   }
   `;
   ```

2. **Multiple Files**: Pass an array of CodeFile objects:

   ```typescript
   // Multiple files
   const code = [
     {
       name: "App.tsx",
       content:
         "import React from 'react';\nimport Button from './Button';\n...",
       isEntry: true, // Mark this as the entry point
     },
     {
       name: "Button.tsx",
       content:
         "export default function Button() { return <button>Click me</button>; }",
     },
   ];
   ```

   The `CodeFile` interface:

   ```typescript
   interface CodeFile {
     name: string; // File name with extension (used for imports)
     content: string; // File content
     isEntry?: boolean; // Whether this is the entry point (defaults to first file if not specified)
   }
   ```

## Security

React-EXE includes built-in security measures:

- Default security patterns to block potentially harmful code
- Custom security pattern support
- Error boundary protection

Default blocked patterns include:

```typescript
const defaultSecurityPatterns = [
  /document\.cookie/i,
  /window\.document\.cookie/i,
  /eval\(/i,
  /Function\(/i,
  /document\.write/i,
  /document\.location/i,
];
```

## TypeScript Support

React-EXE is written in TypeScript and includes type definitions. For the best development experience, use TypeScript in your project:

```tsx
import { CodeExecutor, CodeExecutorConfig, CodeFile } from "react-exe";

const config: CodeExecutorConfig = {
  enableTailwind: true,
  dependencies: {
    "my-component": MyComponent,
  },
};

const files: CodeFile[] = [
  {
    name: "App.tsx",
    content: `export default function App() { return <div>Hello</div>; }`,
    isEntry: true,
  },
];

function App() {
  return <CodeExecutor code={files} config={config} />;
}
```

## Used By [TuneChat](https://chat.tune.app/) to render Artifacts

<img width="1512" alt="Screenshot 2025-02-26 at 16 58 34" src="https://github.com/user-attachments/assets/8b3d096f-1db3-47c3-be90-712c50bdd6d3" />

## License

MIT — Made with 🖐️ by [slaps.dev](https://slaps.dev) and [Vikrant](https://www.linkedin.com/in/vikrant-guleria/)
