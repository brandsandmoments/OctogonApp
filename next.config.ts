import type { NextConfig } from 'next';

const config: NextConfig = {
  // Conexiunea la Postgres trăiește pe server; nu o împachetăm în bundle-ul clientului.
  serverExternalPackages: ['pg'],
};

export default config;
