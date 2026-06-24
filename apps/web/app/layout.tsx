import type { Metadata } from "next";
import { Inter, Zain } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const zain = Zain({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-zain",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "We Glue", template: "%s | We Glue" },
  description: "We Glue — your campus community, all in one place.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${zain.variable}`}>
      <body className="bg-cream text-gray-900 antialiased font-inter">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
