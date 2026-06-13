import type { Metadata } from "next";
import { Fira_Sans, Fira_Code } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { Providers } from "@/components/providers";

const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
  preload: false,
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-code",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: process.env.NEXT_PUBLIC_APP_NAME ?? "My App",
    template: `%s | ${process.env.NEXT_PUBLIC_APP_NAME ?? "My App"}`,
  },
  description: "A Next.js starter kit with auth, admin, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${firaSans.variable} ${firaCode.variable}`}
    >
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
