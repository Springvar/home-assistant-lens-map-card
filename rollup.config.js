import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default {
    input: 'src/lens-map-card.ts',
    output: {
        file: 'dist/home-assistant-lens-map-card.js',
        format: 'es',
        sourcemap: false
    },
    plugins: [
        resolve({
            exportConditions: ['dom', 'module']
        }),
        typescript(),
        terser()
    ]
};