/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/grid/**/*.{html,tsx,ts}"],
  theme: {
    extend: {
      colors: {
        bg: "#131313",
        card: "#1b1a19",
        "card-skel": "#232221",
        border: "#262524",
        text: "#f0efed",
        subtext: "#8d8a85",
        faint: "#6d6a66",
        accent: "#1da0c3",
        "accent-hover": "#62aeca",
        warn: "#d9a13f",
        danger: "#e28b7a",
      },
      keyframes: {
        shimmer: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.75" },
        },
        eq1: { "0%, 100%": { height: "3px" }, "50%": { height: "11px" } },
        eq2: { "0%, 100%": { height: "10px" }, "40%": { height: "4px" }, "70%": { height: "12px" } },
        eq3: { "0%, 100%": { height: "6px" }, "30%": { height: "12px" }, "60%": { height: "3px" } },
      },
      animation: {
        shimmer: "shimmer 1.6s ease-in-out infinite",
        eq1: "eq1 .9s ease-in-out infinite",
        eq2: "eq2 1.1s ease-in-out infinite",
        eq3: "eq3 .8s ease-in-out infinite",
        spin: "spin 1s linear infinite",
      },
    },
  },
  plugins: [],
};
