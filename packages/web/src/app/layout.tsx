import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenChess",
  description:
    "Play chess in your browser: pass and play, or take on six engine personalities. Everything runs locally.",
};

export const viewport: Viewport = {
  themeColor: "#14100B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
