import { defineConfig, type PluginOption } from 'vite';
import { resolve } from 'node:path';

// Loaded via dynamic import because both plugins are ESM-only packages and
// Electron Forge loads this config file as CommonJS (static `require` would
// fail on ESM modules, but CJS can `await import()` them).
const loadPlugins = async (): Promise<PluginOption[]> => {
  const [{ default: react }, { default: tailwindcss }] = await Promise.all([
    import('@vitejs/plugin-react'),
    import('@tailwindcss/vite'),
  ]);
  return [react(), tailwindcss()];
};

// https://vitejs.dev/config
export default defineConfig(async () => ({
  plugins: await loadPlugins(),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
}));
