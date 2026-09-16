import type { Metadata, Viewport } from 'next';
import './globals.css';
import './reference.css';
import './video.css';
import './cleanup.css';
import './animation.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const metadata: Metadata = {
  metadataBase: new URL('https://gamgid.github.io'),
  title: 'Облік DEMO',
  description: 'Демонстраційна пародія мобільного сервісу. Не є документом.',
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Облік DEMO' },
  icons: { apple: `${basePath}/icon-192.png`, icon: `${basePath}/icon-192.png` },
  openGraph: { title: 'Облік DEMO', description: 'Демонстраційна пародія — не є документом', images: [`${basePath}/icon-512.png`] },
  twitter: { card: 'summary', title: 'Облік DEMO', description: 'Демонстраційна пародія — не є документом', images: [`${basePath}/icon-512.png`] },
};
export const viewport: Viewport = { themeColor: '#243d31', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="uk"><body>{children}</body></html>; }
