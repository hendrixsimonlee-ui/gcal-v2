import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
