import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  title: 'OctogonApp',
  description: 'Producție: de la comanda lansată până la intrarea în depozit.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
