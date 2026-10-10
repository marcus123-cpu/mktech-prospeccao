import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MKTech Prospecção", template: "%s · MKTech Prospecção" },
  description: "CRM de prospecção da MKTech Dev",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0f1224", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
