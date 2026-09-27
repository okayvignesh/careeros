import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        'bg-elev': 'hsl(var(--bg-elev))',
        'bg-hover': 'hsl(var(--bg-hover))',
        fg: 'hsl(var(--fg))',
        'fg-muted': 'hsl(var(--fg-muted))',
        'fg-subtle': 'hsl(var(--fg-subtle))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        accent: 'hsl(var(--accent))',
        'accent-fg': 'hsl(var(--accent-fg))',
        success: 'hsl(var(--success))',
        warn: 'hsl(var(--warn))',
        danger: 'hsl(var(--danger))',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      transitionTimingFunction: {
        ease: 'var(--ease)',
        spring: 'var(--ease-spring)',
      },
    },
  },
  plugins: [animate],
};

export default config;
