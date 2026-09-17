import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Leave the HiGHS solver alone rather than bundling it.
  //
  // It ships a .wasm alongside its JS, and the bundler treats that as a client
  // asset URL — it lands in .next/static/media and never reaches the server
  // function, so the loader can't find it at runtime on Vercel. Marking the
  // package external makes it a plain require from node_modules, where the
  // .wasm sits next to the .js exactly as the loader expects.
  serverExternalPackages: ["highs"],

  images: {
    // Google profile photos.
    //
    // next/image refuses any remote host that isn't listed here, so without
    // this the avatars 400 and everyone keeps the fallback initial even once
    // their photo is stored. Google serves them from lh3/lh4/lh5... under
    // googleusercontent.com, so the subdomain is wildcarded rather than
    // guessed at; the pathname stays open because the URLs are opaque and
    // change shape over time.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
