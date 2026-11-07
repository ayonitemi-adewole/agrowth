import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev:phone` serves over HTTPS on your network, so a phone on the same Wi-Fi
// can open the app and share precise GPS (browsers only allow that on secure pages).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: mode === 'phone' ? { host: true } : undefined,
  // `npm run preview:phone`: the production build (with offline support) on your network.
  preview: mode === 'phone' ? { host: true } : undefined,
}));
