import { evaluateConditions, extractDistanceThreshold, evaluateTrailPointConditions, type TrailPointContext } from './condition-evaluator';
import type { PersonConfig, DisplayCondition, SensorCondition, GroupCondition, NotCondition } from './types';

function makeHass(overrides: Record<string, any> = {}) {
    return {
        states: {
            'person.john': { state: 'home', attributes: { friendly_name: 'John', user_id: 'user-1', latitude: 52.5, longitude: 13.4 } },
            'person.jane': { state: 'away', attributes: { friendly_name: 'Jane', user_id: 'user-2', latitude: 48.1, longitude: 11.6 } },
            'sensor.temperature': { state: '22.5', attributes: {} },
            'binary_sensor.motion': { state: 'on', attributes: {} },
            'zone.home': { state: 'zoning', attributes: { friendly_name: 'Home', latitude: 52.5, longitude: 13.4 } },
        },
        user: { id: 'user-1', name: 'John' },
        ...overrides,
    };
}

function makePerson(overrides: Partial<PersonConfig> = {}): PersonConfig {
    return {
        entity_id: 'person.john',
        name: 'John',
        namedSensors: {
            temperature: { entity_id: 'sensor.temperature' },
            motion: { entity_id: 'binary_sensor.motion' },
        },
        ...overrides,
    };
}

describe('evaluateConditions', () => {
    describe('empty conditions', () => {
        it('returns true for empty array', () => {
            expect(evaluateConditions(makeHass(), makePerson(), null, [])).toBe(true);
        });
    });

    describe('SensorCondition - distance', () => {
        it('evaluates distance less than', () => {
            const cond: SensorCondition = { sensor: 'distance', comparator: 'lt', value: 1000000 };
            const loc = { latitude: 52.5, longitude: 13.4 };
            expect(evaluateConditions(makeHass(), makePerson(), loc, cond)).toBe(true);
        });

        it('evaluates distance greater than', () => {
            const cond: SensorCondition = { sensor: 'distance', comparator: 'gt', value: 100 };
            const userLoc = { latitude: 48.1, longitude: 11.6 };
            expect(evaluateConditions(makeHass(), makePerson(), userLoc, cond)).toBe(true);
        });

        it('returns false when no user location', () => {
            const cond: SensorCondition = { sensor: 'distance', comparator: 'lt', value: 1000 };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(false);
        });
    });

    describe('SensorCondition - state', () => {
        it('evaluates state equality', () => {
            const cond: SensorCondition = { sensor: 'state', comparator: 'eq', value: 'home' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('evaluates state not equal', () => {
            const cond: SensorCondition = { sensor: 'state', comparator: 'ne', value: 'away' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - named sensors', () => {
        it('evaluates named sensor value', () => {
            const cond: SensorCondition = { sensor: 'temperature', comparator: 'gt', value: 20 };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('evaluates named sensor with attribute', () => {
            const person = makePerson({
                namedSensors: { discord: { entity_id: 'sensor.discord', attribute: 'game' } },
            });
            const hass = makeHass({
                states: {
                    ...makeHass().states,
                    'sensor.discord': { state: 'playing', attributes: { game: 'Minecraft' } },
                },
            });
            const cond: SensorCondition = { sensor: 'discord', comparator: 'eq', value: 'Minecraft', attribute: 'game' };
            expect(evaluateConditions(hass, person, null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - who', () => {
        it('matches person by entity_id', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'eq', value: 'person.john' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('matches person by short name', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'eq', value: 'john' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('matches person by custom name', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'eq', value: 'John' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('does not match wrong person', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'eq', value: 'person.jane' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(false);
        });

        it('ne comparator works', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'ne', value: 'person.jane' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('oneOf comparator works', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'oneOf', value: 'person.jane,person.john' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('notOneOf comparator works', () => {
            const cond: SensorCondition = { sensor: 'who', comparator: 'notOneOf', value: 'person.jane,person.bob' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - user', () => {
        it('matches by "user" literal', () => {
            const cond: SensorCondition = { sensor: 'user', comparator: 'eq', value: 'user' };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('does not match when wrong user', () => {
            const cond: SensorCondition = { sensor: 'user', comparator: 'eq', value: 'user' };
            const jane = makePerson({ entity_id: 'person.jane' });
            expect(evaluateConditions(makeHass(), jane, null, cond)).toBe(false);
        });

        it('ne comparator works', () => {
            const cond: SensorCondition = { sensor: 'user', comparator: 'ne', value: 'user' };
            const jane = makePerson({ entity_id: 'person.jane' });
            expect(evaluateConditions(makeHass(), jane, null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - when', () => {
        it('matches a time period (value depends on current time)', () => {
            const hour = new Date().getHours();
            let expectedPeriod: string;
            if (hour >= 6 && hour < 12) expectedPeriod = 'morning';
            else if (hour >= 12 && hour < 18) expectedPeriod = 'afternoon';
            else if (hour >= 18 && hour < 24) expectedPeriod = 'evening';
            else expectedPeriod = 'night';

            const cond: SensorCondition = { sensor: 'when', comparator: 'eq', value: expectedPeriod };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - data_age', () => {
        const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

        it('matches data age in minutes', () => {
            const hass = makeHass({
                states: {
                    ...makeHass().states,
                    'person.john': { state: 'home', attributes: {}, last_changed: minutesAgo(1500) }, // 25h
                },
            });
            const cond: SensorCondition = { sensor: 'data_age', comparator: 'gt', value: 1440 }; // > 24h
            expect(evaluateConditions(hass, makePerson(), null, cond)).toBe(true);
        });

        it('fails for fresh data', () => {
            const hass = makeHass({
                states: {
                    ...makeHass().states,
                    'person.john': { state: 'home', attributes: {}, last_changed: minutesAgo(30) },
                },
            });
            const cond: SensorCondition = { sensor: 'data_age', comparator: 'gt', value: 1440 };
            expect(evaluateConditions(hass, makePerson(), null, cond)).toBe(false);
        });

        it('returns infinity for missing last_changed (always stale)', () => {
            const hass = makeHass({
                states: {
                    ...makeHass().states,
                    'person.john': { state: 'home', attributes: {} },
                },
            });
            const cond: SensorCondition = { sensor: 'data_age', comparator: 'gt', value: 0 };
            expect(evaluateConditions(hass, makePerson(), null, cond)).toBe(true);
        });

        it('uses last_updated fallback', () => {
            const hass = makeHass({
                states: {
                    ...makeHass().states,
                    'person.john': { state: 'home', attributes: {}, last_updated: minutesAgo(3600) }, // 60h
                },
            });
            const cond: SensorCondition = { sensor: 'data_age', comparator: 'gte', value: 720 }; // >= 12h
            expect(evaluateConditions(hass, makePerson(), null, cond)).toBe(true);
        });
    });

    describe('SensorCondition - random', () => {
        it('always passes when probability is 1', () => {
            const cond: SensorCondition = { sensor: 'random', comparator: 'eq', value: 1 };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });
    });

    describe('GroupCondition - AND', () => {
        it('all pass → true', () => {
            const group: GroupCondition = {
                type: 'AND',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'home' },
                    { sensor: 'temperature', comparator: 'gt', value: 20 },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, group)).toBe(true);
        });

        it('one fails → false', () => {
            const group: GroupCondition = {
                type: 'AND',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'home' },
                    { sensor: 'temperature', comparator: 'gt', value: 30 },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, group)).toBe(false);
        });
    });

    describe('GroupCondition - OR', () => {
        it('one passes → true', () => {
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'away' },
                    { sensor: 'temperature', comparator: 'gt', value: 20 },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, group)).toBe(true);
        });

        it('all fail → false', () => {
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'away' },
                    { sensor: 'temperature', comparator: 'gt', value: 30 },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, group)).toBe(false);
        });
    });

    describe('NotCondition', () => {
        it('inverts true to false', () => {
            const not: NotCondition = {
                type: 'NOT',
                condition: { sensor: 'state', comparator: 'eq', value: 'home' },
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, not)).toBe(false);
        });

        it('inverts false to true', () => {
            const not: NotCondition = {
                type: 'NOT',
                condition: { sensor: 'state', comparator: 'eq', value: 'away' },
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, not)).toBe(true);
        });
    });

    describe('nested conditions', () => {
        it('AND inside OR', () => {
            const cond: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'away' },
                    {
                        type: 'AND',
                        conditions: [
                            { sensor: 'state', comparator: 'eq', value: 'home' },
                            { sensor: 'temperature', comparator: 'gt', value: 20 },
                        ],
                    },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });

        it('NOT inside AND', () => {
            const cond: GroupCondition = {
                type: 'AND',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'home' },
                    { type: 'NOT', condition: { sensor: 'temperature', comparator: 'lt', value: 10 } },
                ],
            };
            expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
        });
    });

    describe('array conditions (implicit AND)', () => {
        it('all pass → true', () => {
            const conds: DisplayCondition[] = [
                { sensor: 'state', comparator: 'eq', value: 'home' },
                { sensor: 'temperature', comparator: 'gt', value: 20 },
            ];
            expect(evaluateConditions(makeHass(), makePerson(), null, conds)).toBe(true);
        });

        it('one fails → false', () => {
            const conds: DisplayCondition[] = [
                { sensor: 'state', comparator: 'eq', value: 'home' },
                { sensor: 'temperature', comparator: 'gt', value: 30 },
            ];
            expect(evaluateConditions(makeHass(), makePerson(), null, conds)).toBe(false);
        });
    });
});

describe('extractDistanceThreshold', () => {
    it('extracts from flat condition', () => {
        const conds: DisplayCondition[] = [
            { sensor: 'distance', comparator: 'lt', value: 500 },
        ];
        expect(extractDistanceThreshold(conds)).toBe(500);
    });

    it('extracts from nested group', () => {
        const conds: DisplayCondition[] = [
            {
                type: 'AND',
                conditions: [
                    { sensor: 'state', comparator: 'eq', value: 'home' },
                    { sensor: 'distance', comparator: 'lte', value: 2000 },
                ],
            },
        ];
        expect(extractDistanceThreshold(conds)).toBe(2000);
    });

    it('returns null when no distance condition', () => {
        const conds: DisplayCondition[] = [
            { sensor: 'state', comparator: 'eq', value: 'home' },
        ];
        expect(extractDistanceThreshold(conds)).toBeNull();
    });

    it('returns null for empty array', () => {
        expect(extractDistanceThreshold([])).toBeNull();
    });
});

describe('DEFAULT condition', () => {
    it('returns true when no defaultConditions provided', () => {
        const cond: DisplayCondition = { type: 'DEFAULT' };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
    });

    it('returns true when defaultConditions is empty', () => {
        const cond: DisplayCondition = { type: 'DEFAULT' };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond, [])).toBe(true);
    });

    it('evaluates the default conditions for the person', () => {
        const cond: DisplayCondition = { type: 'DEFAULT' };
        const defaults: DisplayCondition[] = [{ sensor: 'state', comparator: 'eq', value: 'home' }];
        expect(evaluateConditions(makeHass(), makePerson(), null, cond, defaults)).toBe(true);
        expect(evaluateConditions(makeHass(), makePerson({ entity_id: 'person.jane' }), null, cond, defaults)).toBe(false);
    });

    it('works inside an OR group', () => {
        const group: DisplayCondition = {
            type: 'OR',
            conditions: [
                { type: 'DEFAULT' },
                { sensor: 'who', comparator: 'eq', value: 'person.jane' },
            ],
        };
        const defaults: DisplayCondition[] = [{ sensor: 'state', comparator: 'eq', value: 'home' }];

        // john matches defaults
        expect(evaluateConditions(makeHass(), makePerson(), null, group, defaults)).toBe(true);
        // jane doesn't match defaults, but matches who
        expect(evaluateConditions(makeHass(), makePerson({ entity_id: 'person.jane' }), null, group, defaults)).toBe(true);
    });

    it('works inside an AND group', () => {
        const group: DisplayCondition = {
            type: 'AND',
            conditions: [
                { type: 'DEFAULT' },
                { sensor: 'who', comparator: 'eq', value: 'person.john' },
            ],
        };
        const defaults: DisplayCondition[] = [{ sensor: 'state', comparator: 'eq', value: 'home' }];

        // john matches both
        expect(evaluateConditions(makeHass(), makePerson(), null, group, defaults)).toBe(true);
        // jane matches who but not defaults
        expect(evaluateConditions(makeHass(), makePerson({ entity_id: 'person.jane' }), null, group, defaults)).toBe(false);
    });

    it('works inside NOT', () => {
        const not: DisplayCondition = {
            type: 'NOT',
            condition: { type: 'DEFAULT' },
        };
        const defaults: DisplayCondition[] = [{ sensor: 'state', comparator: 'eq', value: 'home' }];

        // john matches defaults, NOT inverts to false
        expect(evaluateConditions(makeHass(), makePerson(), null, not, defaults)).toBe(false);
        // jane doesn't match defaults, NOT inverts to true
        expect(evaluateConditions(makeHass(), makePerson({ entity_id: 'person.jane' }), null, not, defaults)).toBe(true);
    });
});

describe('SensorCondition - distance_from_person (display)', () => {
    it('evaluates distance between two persons', () => {
        const cond: SensorCondition = {
            sensor: 'distance_from_person',
            comparator: 'lt',
            value: 1000000,
            target_person: 'person.jane',
        };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
    });

    it('returns Infinity when target_person is missing', () => {
        const cond: SensorCondition = {
            sensor: 'distance_from_person',
            comparator: 'lt',
            value: 1000,
        };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(false);
    });

    it('resolves "self" to the person being evaluated', () => {
        const cond: SensorCondition = {
            sensor: 'distance_from_person',
            comparator: 'lt',
            value: 1,
            target_person: 'self',
        };
        const loc = { latitude: 52.5, longitude: 13.4 };
        expect(evaluateConditions(makeHass(), makePerson(), loc, cond)).toBe(true);
    });
});

describe('SensorCondition - distance_from_zone (display)', () => {
    it('evaluates distance from person to zone', () => {
        const cond: SensorCondition = {
            sensor: 'distance_from_zone',
            comparator: 'lt',
            value: 1000000,
            zone: { lat: 52.5, lon: 13.4 },
        };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(true);
    });

    it('returns Infinity when zone is missing', () => {
        const cond: SensorCondition = {
            sensor: 'distance_from_zone',
            comparator: 'lt',
            value: 1000,
        };
        expect(evaluateConditions(makeHass(), makePerson(), null, cond)).toBe(false);
    });
});

describe('evaluateTrailPointConditions', () => {
    function makeTrailCtx(overrides: Partial<TrailPointContext> = {}): TrailPointContext {
        return {
            point: { lat: 52.5, lon: 13.4 },
            personLocation: { latitude: 52.5, longitude: 13.4 },
            userLocation: { latitude: 52.5, longitude: 13.4 },
            hass: makeHass(),
            person: makePerson(),
            ...overrides,
        };
    }

    describe('distance_from_user', () => {
        it('passes when point is within distance', () => {
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const cond: SensorCondition = { sensor: 'distance_from_user', comparator: 'lte', value: 100 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(true);
        });

        it('fails when point is far away', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const cond: SensorCondition = { sensor: 'distance_from_user', comparator: 'lte', value: 100 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(false);
        });

        it('returns Infinity when no user location', () => {
            const ctx = makeTrailCtx({ userLocation: null });
            const cond: SensorCondition = { sensor: 'distance_from_user', comparator: 'lte', value: 1000000 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(false);
        });
    });

    describe('distance_from_person', () => {
        it('passes when point is near person', () => {
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
                personLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const cond: SensorCondition = { sensor: 'distance_from_person', comparator: 'lte', value: 100 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(true);
        });

        it('fails when point is far from person', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                personLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const cond: SensorCondition = { sensor: 'distance_from_person', comparator: 'lte', value: 100 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(false);
        });
    });

    describe('distance_from_zone', () => {
        it('passes when point is near zone', () => {
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
            });
            const cond: SensorCondition = {
                sensor: 'distance_from_zone',
                comparator: 'lte',
                value: 100,
                zone: { lat: 52.5, lon: 13.4 },
            };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(true);
        });

        it('fails when point is far from zone', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
            });
            const cond: SensorCondition = {
                sensor: 'distance_from_zone',
                comparator: 'lte',
                value: 100,
                zone: { lat: 52.5, lon: 13.4 },
            };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(false);
        });

        it('returns Infinity when zone is missing', () => {
            const ctx = makeTrailCtx();
            const cond: SensorCondition = { sensor: 'distance_from_zone', comparator: 'lte', value: 1000000 };
            expect(evaluateTrailPointConditions(ctx, cond)).toBe(false);
        });
    });

    describe('combined conditions', () => {
        it('AND requires both to pass', () => {
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const group: GroupCondition = {
                type: 'AND',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            };
            expect(evaluateTrailPointConditions(ctx, group)).toBe(true);
        });

        it('OR passes if either passes', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 52.5, longitude: 13.4 },
            });
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            };
            expect(evaluateTrailPointConditions(ctx, group)).toBe(false);
        });

        it('OR passes when point is far from user but near person', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            };
            expect(evaluateTrailPointConditions(ctx, group)).toBe(true);
        });

        it('OR passes when point is near user but far from person', () => {
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            };
            expect(evaluateTrailPointConditions(ctx, group)).toBe(true);
        });

        it('OR fails when point is far from both user and person', () => {
            const ctx = makeTrailCtx({
                point: { lat: 60.0, lon: 20.0 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            const group: GroupCondition = {
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            };
            expect(evaluateTrailPointConditions(ctx, group)).toBe(false);
        });

        it('OR with distance_from_person and distance_from_user as flat array (implicit AND)', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            const conds: DisplayCondition[] = [
                { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
            ];
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(false);
        });

        it('OR with distance_from_person and distance_from_user in OR group', () => {
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: 100 },
                    { sensor: 'distance_from_person', comparator: 'lte', value: 100 },
                ],
            }];
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(true);
        });
    });

    describe('empty conditions', () => {
        it('returns true for empty array', () => {
            expect(evaluateTrailPointConditions(makeTrailCtx(), [])).toBe(true);
        });
    });

    describe('exact user config scenario', () => {
        it('OR: point far from user but near person passes', () => {
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: '3200' },
                    { sensor: 'distance_from_person', comparator: 'lte', value: '5000', target_person: 'self' },
                ],
            }];
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(true);
        });

        it('OR: point near user but far from person passes', () => {
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: '3200' },
                    { sensor: 'distance_from_person', comparator: 'lte', value: '5000', target_person: 'self' },
                ],
            }];
            const ctx = makeTrailCtx({
                point: { lat: 52.5, lon: 13.4 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(true);
        });

        it('OR: point far from both fails', () => {
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: '3200' },
                    { sensor: 'distance_from_person', comparator: 'lte', value: '5000', target_person: 'self' },
                ],
            }];
            const ctx = makeTrailCtx({
                point: { lat: 60.0, lon: 20.0 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(false);
        });

        it('OR: null personLocation means distance_from_person returns Infinity', () => {
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: '3200' },
                    { sensor: 'distance_from_person', comparator: 'lte', value: '5000', target_person: 'self' },
                ],
            }];
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: { latitude: 52.5, longitude: 13.4 },
                personLocation: null,
            });
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(false);
        });

        it('OR: null userLocation means distance_from_user returns Infinity', () => {
            const conds: DisplayCondition[] = [{
                type: 'OR',
                conditions: [
                    { sensor: 'distance_from_user', comparator: 'lte', value: '3200' },
                    { sensor: 'distance_from_person', comparator: 'lte', value: '5000', target_person: 'self' },
                ],
            }];
            const ctx = makeTrailCtx({
                point: { lat: 48.1, lon: 11.6 },
                userLocation: null,
                personLocation: { latitude: 48.1, longitude: 11.6 },
            });
            expect(evaluateTrailPointConditions(ctx, conds)).toBe(true);
        });
    });
});
