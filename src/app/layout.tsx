import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  // The brand sheet uses four weights: regular and medium for body, semi-bold
  // for small headers, bold for large ones.
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PADT Calendar",
  description:
    "Schedule dance practices around conflicts, spaces, and choreographers.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PADT Cal",
  },
  // One source image, declared at every size the platforms ask for.
  //
  // There used to be four separate PNGs, which meant changing the logo needed
  // image tooling nobody running this app has. Browsers scale a single large
  // square perfectly well, so `public/icon.png` is now the only file to
  // replace — drop a new one in and every icon in the app follows.
  icons: {
    icon: [
      { url: "/icon.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tints the phone's status bar and the browser's address bar. Matched to
  // the logo's ground so the app doesn't start with a seam across the top.
  themeColor: "#8a6408",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
