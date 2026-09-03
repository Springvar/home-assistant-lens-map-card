import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry: 'src/whereabouts-map-card.ts',
            formats: ['es'],
            fileName: 'home-assistant-whereabouts-map-card'
        },
        outDir: 'dist',
        rollupOptions: {
            external: [],
            output: {
                entryFileNames: 'home-assistant-whereabouts-map-card.js',
                inlineDynamicImports: true
            }
        },
        minify: 'esbuild'
    },
    server: {
        port: 5173,
        open: '/test/combined.html'
    }
});