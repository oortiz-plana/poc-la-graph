import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        foreground: "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        border: "var(--color-border)",
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        selected: "var(--color-selected-background)",
        success: "var(--color-success)",
        "success-surface": "var(--color-success-surface)",
        "success-border": "var(--color-success-border)",
        warning: "var(--color-warning)",
        "warning-surface": "var(--color-warning-surface)",
        "warning-border": "var(--color-warning-border)",
        error: "var(--color-error)",
        "error-surface": "var(--color-error-surface)",
        "error-border": "var(--color-error-border)",
        information: "var(--color-information)",
        "information-surface": "var(--color-information-surface)",
        "information-border": "var(--color-information-border)",
        card: "var(--color-surface)",
        muted: "var(--color-selected-background)",
        accent: "var(--color-primary)",
        destructive: "var(--color-error)",
        sidebar: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text-primary)",
          accent: "var(--color-selected-background)",
          "accent-foreground": "var(--color-primary)",
          border: "var(--color-border)",
          ring: "var(--color-primary)",
        },
      },
      boxShadow: {
        panel: "0 1px 2px rgb(16 24 40 / 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
