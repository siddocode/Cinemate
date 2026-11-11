import type { Metadata } from 'next';
import { Cormorant_Garamond, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/context/SessionContext';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';

const cormorantGaramond = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Syncora — Private Watch Party Lounge',
  description:
    'Watch YouTube videos, direct streams, and personal uploads together in host-authoritative synchronization with persistent live chat.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${cormorantGaramond.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable} font-sans antialiased min-h-screen flex flex-col bg-[#102B23] text-[#F7F4EC] selection:bg-[#9670FF] selection:text-[#0B1E18]`}
      >
        <SessionProvider>
          <Navbar />
          <main className="flex-1 min-h-0 flex flex-col">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
