import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @cline/llms maps the "react-server" export condition to its trimmed
  // browser bundle, which is missing exports @cline/core/@cline/agents
  // expect (see hephaestus.md for the full story). Next.js applies
  // "react-server" to everything under app/, including plain Node.js Route
  // Handlers like app/api/improve/route.ts — not just actual React Server
  // Components — so it always resolves to the incomplete bundle otherwise.
  // Marking these as external skips Next's bundler for them entirely; they
  // get a real Node `require()` at runtime instead, which resolves the
  // package's "import"/"default" condition (the full build) rather than
  // "react-server".
  serverExternalPackages: [
    "@cline/sdk",
    "@cline/core",
    "@cline/llms",
    "@cline/agents",
    "@cline/shared",
  ],
};

export default nextConfig;
