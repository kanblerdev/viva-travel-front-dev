import type { Metadata } from "next";
import { IconSprite } from "@/components/IconSprite";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viva Travel · CRM Comercial Integral",
  description:
    "Mockup navegable del CRM Comercial Integral de Viva Travel El Salvador.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <IconSprite />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
