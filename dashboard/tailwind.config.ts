import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"), surface: v("surface"), sunken: v("sunken"), ink: v("ink"),
        "ink-soft": v("ink-soft"), muted: v("muted"), hairline: v("hairline"),
        mint: v("mint"), "mint-soft": v("mint-soft"), coral: v("coral"),
      },
    },
  },
  plugins: [],
};
export default config;
