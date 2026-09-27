import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { AppBackground, TooltipProvider } from '@careeros/ui';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-jb',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Career OS',
  description: 'Self-hosted, evidence-based Personal AI Career Operating System.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        <AppBackground />
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
