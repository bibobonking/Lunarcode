/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base tokens (kept for the theme contract): canvas = window, panel = content view.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // Adwaita surfaces.
        headerbar: 'rgb(var(--headerbar) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar) / <alpha-value>)',
        'sidebar-2': 'rgb(var(--sidebar-2) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        popover: 'rgb(var(--popover) / <alpha-value>)',
        dialog: 'rgb(var(--dialog) / <alpha-value>)',
        link: 'rgb(var(--link) / <alpha-value>)',
        destructive: 'rgb(var(--destructive) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Adwaita Sans"', 'Inter', 'Cantarell', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"Adwaita Mono"', 'Iosevka', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '9px',
        xl: '12px',
        '2xl': '15px',
      },
      boxShadow: {
        popover: '0 1px 2px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.14)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        spinslow: { to: { transform: 'rotate(360deg)' } },
        scalein: { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        slideleft: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        slideright: { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        fade: 'fade 0.15s ease-out both',
        rise: 'rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'spin-slow': 'spinslow 18s linear infinite',
        scalein: 'scalein 0.18s ease-out both',
        slideleft: 'slideleft 0.2s ease-out both',
        slideright: 'slideright 0.2s ease-out both',
      },
    },
  },
  plugins: [],
}
