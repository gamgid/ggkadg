import type { Metadata, Viewport } from 'next';
import './globals.css';
import './reference.css';
import './video.css';
import './cleanup.css';
import './animation.css';
import './card-flip.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const metadata: Metadata = {
  metadataBase: new URL('https://gamgid.github.io'),
  title: 'Облік DEMO',
  description: 'Демонстраційна пародія мобільного сервісу. Не є документом.',
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Облік DEMO' },
  icons: {
    apple: [{ url: `${basePath}/apple-touch-icon-v3.png`, sizes: '180x180', type: 'image/png' }],
    icon: [{ url: `${basePath}/pwa-icon-192-v3.png`, sizes: '192x192', type: 'image/png' }],
    shortcut: `${basePath}/pwa-icon-192-v3.png`,
  },
  openGraph: { title: 'Облік DEMO', description: 'Демонстраційна пародія — не є документом', images: [`${basePath}/pwa-icon-512-v3.png`] },
  twitter: { card: 'summary', title: 'Облік DEMO', description: 'Демонстраційна пародія — не є документом', images: [`${basePath}/pwa-icon-512-v3.png`] },
};
export const viewport: Viewport = {
  themeColor: '#243d31',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="uk"><body>{children}</body></html>; }
