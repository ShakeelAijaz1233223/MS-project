/** @type {import('tailwindcss').Config} */
export default {
  // Purple White is the only theme; data-theme is always 'light', so the
  // dark variant never activates. Kept so `dark:` classes elsewhere stay
  // valid Tailwind (they simply never match).
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        secondary: 'var(--bg-secondary)',
        surface: 'var(--surface-card)',
        elevated: 'var(--surface-elevated)',
        accent: 'var(--accent-primary)',
        purpleGlow: 'var(--accent-purple)',
        violetGlow: 'var(--accent-violet)',
        magentaGlow: 'var(--accent-magenta)',
        pinkGlow: 'var(--accent-pink)',
        brand: {
          DEFAULT: '#7C3AED',
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        glow: 'var(--shadow-accent)',
      },
    },
  },
  plugins: [],
};
