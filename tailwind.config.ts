import type { Config } from "tailwindcss";

// Tulip brand palette — extracted from official brand assets (drop.svg uses #231f20).
// The brand is intentionally monochrome: deep ink on bright white, with a quiet
// off-white surface for cards. Wine red is reserved for primary CTAs only.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tulip: {
          ink:      "#231f20",   // brand black (from drop.svg)
          paper:    "#FFFFFF",   // page background — clean white
          surface:  "#F8F6F1",   // off-white for cards / inputs / hover
          line:     "#E5E1D8",   // hairline borders
          muted:    "#8A847A",   // metadata / labels
          quiet:    "#B8B2A7",   // disabled / placeholder
          wine:     "#7A1F2B",   // primary CTA only
          burgundy: "#5C1722",   // CTA hover
          success:  "#2F5D3B",   // won deals
          warning:  "#A6661F",   // pending review
          // legacy aliases used in components — point at new tokens
          cream:    "#F8F6F1",
          sand:     "#E5E1D8",
          forest:   "#231f20",
        },
      },
      fontFamily: {
        // brand uses serif headlines (TULIP wordmark). Frank Ruhl Libre is the
        // closest free Hebrew + Latin serif match. Assistant for UI body.
        sans:  ["Assistant", "Heebo", "system-ui", "sans-serif"],
        serif: ["'Frank Ruhl Libre'", "'Cormorant Garamond'", "ui-serif", "serif"],
      },
      letterSpacing: {
        brand: "0.18em", // for "WINERY" wordmark style
      },
      maxWidth: { content: "1280px" },
    },
  },
  plugins: [],
};
export default config;
