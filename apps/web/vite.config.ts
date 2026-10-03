import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// .env lives at the repo root, shared with the API.
export default defineConfig({ plugins: [react()], envDir: '../..', server: { port: 5173 } });
