import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/context/SessionContext';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Syncora — Real-Time Watch Party for Two',
  description:
    'Watch YouTube videos and personal streams together in real-time synchronization with persistent side-by-side live chat.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col bg-[#090a0f] text-neutral-100 selection:bg-indigo-500 selection:text-white`}
      >
        <SessionProvider>
          <Navbar />
          <main className="flex-1 flex flex-col">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
