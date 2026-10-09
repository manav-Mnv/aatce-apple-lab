import type { Metadata, Viewport } from 'next';
import { LabProvider } from '@/components/LabProvider';
import { Shell } from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apple Lab Admin',
  description: 'Attendance and activity for the AATCE Apple Lab'
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LabProvider>
          <Shell>{children}</Shell>
        </LabProvider>
      </body>
    </html>
  );
}
