/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: [
    'variant',
    [
      ':root:has(> head > meta[name="color-scheme"][content="dark"]) &',
      '@media (prefers-color-scheme: dark) { :root:not(:has(> head > meta[name="color-scheme"][content="light"])) & }',
    ],
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
