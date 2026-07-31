/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp's native libvips binaries (@img/*) must be traced into the
  // serverless function for the Grant-style report charts on Vercel.
  outputFileTracingIncludes: {
    // both layouts: npm/yarn hoist to node_modules/@img, pnpm keeps the real
    // files under node_modules/.pnpm/@img+*
    "/clients/[id]/export": [
      "./node_modules/@img/**/*",
      "./node_modules/.pnpm/@img*/**/*",
    ],
  },
}

export default nextConfig
