import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Spending Tracker — monthly financial pulse',
  description: 'Upload bank statements, track spending trends',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className + ' antialiased min-h-screen'}>{children}</body>
    </html>
  );
}
