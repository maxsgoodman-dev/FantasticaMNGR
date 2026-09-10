import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { SidebarProvider } from "@/components/SidebarContext";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Fantasy Analytics Dashboard",
  description: "Multi-league fantasy sports analytics dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-canvas font-sans text-ink-primary antialiased">
        <SidebarProvider>
          <div className="flex min-h-screen flex-col">
            <TopBar />
            <div className="flex flex-1">
              <Sidebar />
              <main className="flex-1 overflow-x-hidden p-4 md:p-10">{children}</main>
            </div>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
