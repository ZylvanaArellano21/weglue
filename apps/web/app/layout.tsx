import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "We Glue", template: "%s | We Glue" },
  description: "We Glue — bringing things together.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
