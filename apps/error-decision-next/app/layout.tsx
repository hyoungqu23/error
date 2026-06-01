import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Error Decision System - Next",
  description: "Next.js demo for the Error Decision System architecture.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
