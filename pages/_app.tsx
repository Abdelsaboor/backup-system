// 📍 File: pages/_app.tsx

import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from '@/components/theme-provider'; // ✨ This is the line you need to add

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Component {...pageProps} />
      <Toaster />
    </ThemeProvider>
  )
}