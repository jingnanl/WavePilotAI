import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WavePilotAI',
  description: 'AI-powered stock analysis and trading platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}