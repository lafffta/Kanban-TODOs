import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { OfflineBanner } from "./pwa/offline-banner";
import { ServiceWorkerRegistrar } from "./pwa/service-worker";

export const metadata: Metadata = {
  title: "Kanban Task Tracker",
  description: "Shared kanban boards for teams.",
  // iOS ignores the manifest for home-screen launches and reads these instead.
  appleWebApp: { capable: true, title: "Kanban", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // Matches the manifest's theme colour, so the system chrome around an installed
  // launch is the same slate as the icon.
  themeColor: "#0f172a",
  // The board is a wide scrolling surface; letting a phone zoom out to fit it
  // would shrink the cards to nothing.
  width: "device-width",
  initialScale: 1,
  // Installed with no browser chrome, the app draws under the notch and the home
  // indicator — `env(safe-area-inset-*)` puts its own padding back.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* `h-dvh` rather than `min-h-full`: on a phone the board scrolls inside the
          viewport, so the page itself must not grow past it. */}
      <body className="flex h-dvh flex-col overflow-hidden">
        <Providers>
          <OfflineBanner />
          {children}
          <ServiceWorkerRegistrar />
        </Providers>
      </body>
    </html>
  );
}
