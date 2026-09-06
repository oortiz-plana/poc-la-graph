import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // `monaco-editor` (ESM build) imports plain `.css` files from inside
  // node_modules (e.g. standalone-tokens.css). Next.js only allows external CSS
  // when the package is listed here, which also routes its CSS through Next's
  // own CSS pipeline (mini-css-extract + asset handling for the codicon font).
  transpilePackages: ["monaco-editor"],
};

export default nextConfig;
