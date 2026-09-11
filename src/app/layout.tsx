import type { Metadata, Viewport } from "next";
import "./globals.css";

// 中文字型檔很大，改由瀏覽器執行期載入（建置時不下載），並有系統字型後備
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;900&display=swap";

export const metadata: Metadata = {
  title: "月夜狼人殺",
  description: "單人對戰 AI 的狼人殺",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0e1a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body className="min-h-full">
        <div className="mx-auto min-h-dvh w-full max-w-[480px] relative overflow-hidden">{children}</div>
      </body>
    </html>
  );
}
