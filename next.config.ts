import type { NextConfig } from 'next';

const config: NextConfig = {
  // Conexiunea la Postgres trăiește pe server; nu o împachetăm în bundle-ul clientului.
  serverExternalPackages: ['pg'],
  experimental: {
    // Pozele de la cererile de tipar (până la 8 MB în bază) urcă prin acțiuni de server.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
