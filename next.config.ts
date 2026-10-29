import type { NextConfig } from 'next';

const config: NextConfig = {
  // Conexiunea la Postgres trăiește pe server; nu o împachetăm în bundle-ul clientului.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // Antetele de securitate: pagina nu se poate pune în cadrul altui site (clickjacking),
  // tipul fișierelor nu se ghicește, adresa nu pleacă spre alte site-uri, iar camera
  // (scanarea etichetelor) o poate cere doar aplicația.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      ],
    }];
  },
  experimental: {
    // Pozele de la cererile de tipar (până la 8 MB în bază) urcă prin acțiuni de server.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
