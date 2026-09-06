import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './whereabouts-map-card';

function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function getCardClass(): any {
    return (globalThis as any).customElements.get('whereabouts-map-card');
}

describe('WhereaboutsMapCard staleness', () => {
    let el: any;
    let origL: any;

    beforeEach(() => {
        el = new (getCardClass())();
        origL = (globalThis as any).L;
        (globalThis as any).L = {
            divIcon: (opts: any) => opts,
        };
        el._hass = {
            states: {},
            hassUrl: (u: string) => u,
        };
    });

    afterEach(() => {
        el = null;
        delete (globalThis as any).L;
        if (origL !== undefined) (globalThis as any).L = origL;
    });

    function setPerson(entityId: string, iso: string) {
        el._hass.states[entityId] = {
            state: 'home',
            last_changed: iso,
            last_updated: iso,
            attributes: {
                friendly_name: entityId,
                latitude: 52.5,
                longitude: 13.4,
                source: 'device_tracker.test',
                device_trackers: ['device_tracker.test'],
            },
        };
    }

    describe('_isStale', () => {
        it('marks person stale when data older than threshold', () => {
            setPerson('person.old', hoursAgo(20));
            el.stale_after_hours = 8;
            expect(el._isStale('person.old')).toBe(true);
        });

        it('keeps person fresh when data newer than threshold', () => {
            setPerson('person.fresh', hoursAgo(1));
            el.stale_after_hours = 8;
            expect(el._isStale('person.fresh')).toBe(false);
        });

        it('prefers last_updated when it is fresh and last_changed is old', () => {
            setPerson('person.attr', hoursAgo(30));
            el._hass.states['person.attr'].last_updated = hoursAgo(1);
            el.stale_after_hours = 8;
            expect(el._isStale('person.attr')).toBe(false);
        });

        it('falls back to last_changed when last_updated missing', () => {
            setPerson('person.attr', hoursAgo(20));
            delete el._hass.states['person.attr'].last_updated;
            el.stale_after_hours = 8;
            expect(el._isStale('person.attr')).toBe(true);
        });

        it('returns false when feature disabled', () => {
            setPerson('person.old', hoursAgo(500));
            el.stale_after_hours = 0;
            expect(el._isStale('person.old')).toBe(false);
        });

        it('returns stale for missing entity', () => {
            el.stale_after_hours = 8;
            expect(el._isStale('person.missing')).toBe(true);
        });

        it('returns false when threshold not configured', () => {
            setPerson('person.old', hoursAgo(500));
            expect(el._isStale('person.old')).toBe(false);
        });
    });

    describe('_getDataAgeHours', () => {
        it('computes hours from last_updated', () => {
            setPerson('person.old', hoursAgo(24));
            const hours = el._getDataAgeHours('person.old');
            expect(hours).toBeGreaterThan(23);
            expect(hours).toBeLessThan(25);
        });

        it('uses last_updated when it is fresh and last_changed is old', () => {
            setPerson('person.attr', hoursAgo(30));
            el._hass.states['person.attr'].last_updated = hoursAgo(2);
            const hours = el._getDataAgeHours('person.attr');
            expect(hours).toBeGreaterThan(1);
            expect(hours).toBeLessThan(3);
        });

        it('falls back to last_changed when last_updated missing', () => {
            setPerson('person.attr', hoursAgo(2));
            delete el._hass.states['person.attr'].last_updated;
            const hours = el._getDataAgeHours('person.attr');
            expect(hours).toBeGreaterThan(1);
            expect(hours).toBeLessThan(3);
        });

        it('returns Infinity for missing entity', () => {
            expect(el._getDataAgeHours('person.missing')).toBe(Infinity);
        });
    });

    describe('_createPersonIcon', () => {
        it('adds stale class when isStale is true', () => {
            setPerson('person.old', hoursAgo(20));
            const icon = el._createPersonIcon(
                el._hass.states['person.old'],
                'Old',
                true
            );
            expect(icon.className).toContain('person-marker');
            expect(icon.className).toContain('stale');
        });

        it('omits stale class when fresh', () => {
            setPerson('person.fresh', hoursAgo(1));
            const icon = el._createPersonIcon(
                el._hass.states['person.fresh'],
                'Fresh',
                false
            );
            expect(icon.className).toContain('person-marker');
            expect(icon.className).not.toContain('stale');
        });
    });
});