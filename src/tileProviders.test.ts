import { describe, it, expect } from 'vitest';
import {
    TILE_PROVIDERS,
    VALID_MAPS,
    getTileProvider,
    requiresApiKey,
    getTileProviderHelp,
    buildTileUrl,
} from './tileProviders';

describe('tileProviders', () => {
    it('classifies keyless providers', () => {
        expect(requiresApiKey('color')).toBe(false);
        expect(requiresApiKey('satellite')).toBe(false);
        expect(requiresApiKey('topo')).toBe(false);
    });

    it('classifies keyed providers', () => {
        expect(requiresApiKey('light')).toBe(true);
        expect(requiresApiKey('dark')).toBe(true);
        expect(requiresApiKey('voyager')).toBe(true);
        expect(requiresApiKey('bw')).toBe(true);
        expect(requiresApiKey('outlines')).toBe(true);
    });

    it('exposes all providers through VALID_MAPS', () => {
        expect(VALID_MAPS.size).toBe(TILE_PROVIDERS.length);
        for (const p of TILE_PROVIDERS) {
            expect(VALID_MAPS.has(p.id)).toBe(true);
        }
    });

    it('looks up providers by id', () => {
        expect(getTileProvider('color')?.group).toBe('keyless');
        expect(getTileProvider('dark')?.group).toBe('keyed');
        expect(getTileProvider('does-not-exist')).toBeUndefined();
    });

    it('appends the CARTO ?key= param for CARTO providers', () => {
        const url = buildTileUrl('light', 'mykey');
        expect(url).toContain('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=mykey');
    });

    it('appends the Stadia ?api_key= param for Stadia providers', () => {
        const url = buildTileUrl('bw', 'mykey');
        expect(url).toContain('https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png?api_key=mykey');
    });

    it('does not append a key for keyless providers', () => {
        const url = buildTileUrl('color', 'mykey');
        expect(url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    it('does not append a key when none is provided', () => {
        expect(buildTileUrl('dark', undefined)).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png');
    });

    it('trims the key before appending', () => {
        const url = buildTileUrl('dark', '  mykey  ');
        expect(url).toContain('?key=mykey');
    });

    it('returns empty string for unknown ids', () => {
        expect(buildTileUrl('nope', 'key')).toBe('');
    });

    it('returns provider help text', () => {
        expect(getTileProviderHelp('light')).toContain('CARTO');
        expect(getTileProviderHelp('bw')).toContain('Stadia');
        expect(getTileProviderHelp('color')).toBe('');
    });
});
