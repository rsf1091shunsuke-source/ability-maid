import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ability Maid',
  description: 'リアルタイム対戦 能力ババ抜き',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, background: '#1a1a2e', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
