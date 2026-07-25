import type { MetadataRoute } from "next";

/** The manifest is the same for everyone, so it is built once, not per request. */
export const dynamic = "force-static";

/**
 * The web app manifest (D8) — what makes the board installable to a phone's home
 * screen, served by Next at `/manifest.webmanifest`.
 *
 * `display: standalone` is the point of the ticket: launched from the home screen
 * the app has no browser chrome, so the board has to carry its own navigation and
 * its own "you're offline" signal (see `OfflineBanner`).
 *
 * `start_url` is the boards list rather than `/`: a launch should land on the
 * signed-in home, and when that launch is offline the list hands straight over to
 * the last-seen board (see `LastBoardLaunch`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kanban Task Tracker",
    short_name: "Kanban",
    description: "Shared kanban boards for teams.",
    start_url: "/boards",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Drawn with its mark inside the safe zone, so a platform that crops the
      // icon to a circle or a squircle doesn't clip a lane off.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
