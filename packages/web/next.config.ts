import type { NextConfig } from "next";

// GitHub Pages serves a project site from /<repo>, so the deploy workflow sets
// NEXT_PUBLIC_BASE_PATH to that prefix. Locally it is empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@openchess/shared"],
};

export default config;
