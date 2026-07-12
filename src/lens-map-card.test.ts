import { describe, it, expect } from 'vitest';

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000;
}

function evaluateRule(rule: { operator: string; value: string }, sensorValue: number | string): boolean {
    const value = parseFloat(rule.value);
    if (isNaN(value)) {
        if (rule.operator === '=') return String(sensorValue) === rule.value;
        if (rule.operator === '!=') return String(sensorValue) !== rule.value;
    }
    const numValue = typeof sensorValue === 'number' ? sensorValue : parseFloat(String(sensorValue));
    if (isNaN(numValue)) return false;
    switch (rule.operator) {
        case '<': return numValue < value;
        case '<=': return numValue <= value;
        case '>': return numValue > value;
        case '>=': return numValue >= value;
        case '=': return numValue === value;
        case '!=': return numValue !== value;
        default: return false;
    }
}

describe('haversine', () => {
    it('should calculate distance between two points', () => {
        const result = haversine(52.5200, 13.4050, 52.5200, 13.4050);
        expect(result).toBe(0);
    });

    it('should calculate distance between Berlin and Munich', () => {
        const berlin = { lat: 52.52, lon: 13.405 };
        const munich = { lat: 48.1351, lon: 11.582 };
        const result = haversine(berlin.lat, berlin.lon, munich.lat, munich.lon);
        expect(result).toBeGreaterThan(500000);
        expect(result).toBeLessThan(600000);
    });
});

describe('evaluateRule', () => {
    it('should evaluate less than operator', () => {
        expect(evaluateRule({ operator: '<', value: '1000' }, 500)).toBe(true);
        expect(evaluateRule({ operator: '<', value: '1000' }, 1500)).toBe(false);
    });

    it('should evaluate less than or equal operator', () => {
        expect(evaluateRule({ operator: '<=', value: '1000' }, 1000)).toBe(true);
        expect(evaluateRule({ operator: '<=', value: '1000' }, 1001)).toBe(false);
    });

    it('should evaluate greater than operator', () => {
        expect(evaluateRule({ operator: '>', value: '1000' }, 1500)).toBe(true);
        expect(evaluateRule({ operator: '>', value: '1000' }, 500)).toBe(false);
    });

    it('should evaluate greater than or equal operator', () => {
        expect(evaluateRule({ operator: '>=', value: '1000' }, 1000)).toBe(true);
        expect(evaluateRule({ operator: '>=', value: '1000' }, 999)).toBe(false);
    });

    it('should evaluate equals operator', () => {
        expect(evaluateRule({ operator: '=', value: '1000' }, 1000)).toBe(true);
        expect(evaluateRule({ operator: '=', value: '1000' }, 999)).toBe(false);
    });

    it('should evaluate not equals operator', () => {
        expect(evaluateRule({ operator: '!=', value: '1000' }, 999)).toBe(true);
        expect(evaluateRule({ operator: '!=', value: '1000' }, 1000)).toBe(false);
    });

    it('should handle string values for equality', () => {
        expect(evaluateRule({ operator: '=', value: 'home' }, 'home')).toBe(true);
        expect(evaluateRule({ operator: '=', value: 'home' }, 'away')).toBe(false);
    });
});

import { migrateDisplayRule, migrateDisplayRules } from './types';

describe('migrateDisplayRule', () => {
    it('converts a single DisplayRule to SensorCondition', () => {
        const rule = { id: 'default', priority: 1, sensor: 'distance', operator: '<' as const, value: '1000', enabled: true };
        const result = migrateDisplayRule(rule);
        expect(result).toEqual({ sensor: 'distance', comparator: 'lt', value: '1000' });
    });

    it('maps all operator types correctly', () => {
        const operators = [
            { old: '<' as const, new: 'lt' },
            { old: '<=' as const, new: 'lte' },
            { old: '>' as const, new: 'gt' },
            { old: '>=' as const, new: 'gte' },
            { old: '=' as const, new: 'eq' },
            { old: '!=' as const, new: 'ne' },
            { old: 'oneOf' as const, new: 'oneOf' },
        ];
        for (const { old, new: expected } of operators) {
            const result = migrateDisplayRule({ id: 'r', priority: 1, sensor: 'state', operator: old, value: 'x', enabled: true });
            expect(result.comparator).toBe(expected);
        }
    });
});

describe('migrateDisplayRules', () => {
    it('returns empty array for empty input', () => {
        expect(migrateDisplayRules([])).toEqual([]);
    });

    it('filters out disabled rules', () => {
        const rules = [
            { id: 'a', priority: 1, sensor: 'distance', operator: '<' as const, value: '100', enabled: false },
            { id: 'b', priority: 2, sensor: 'state', operator: '=' as const, value: 'home', enabled: true },
        ];
        const result = migrateDisplayRules(rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ sensor: 'state', comparator: 'eq', value: 'home' });
    });

    it('wraps single enabled rule directly (no AND group)', () => {
        const rules = [
            { id: 'a', priority: 1, sensor: 'distance', operator: '<' as const, value: '500', enabled: true },
        ];
        const result = migrateDisplayRules(rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ sensor: 'distance', comparator: 'lt', value: '500' });
    });

    it('wraps multiple enabled rules in AND group', () => {
        const rules = [
            { id: 'a', priority: 2, sensor: 'distance', operator: '<' as const, value: '500', enabled: true },
            { id: 'b', priority: 1, sensor: 'state', operator: '=' as const, value: 'home', enabled: true },
        ];
        const result = migrateDisplayRules(rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            type: 'AND',
            conditions: [
                { sensor: 'distance', comparator: 'lt', value: '500' },
                { sensor: 'state', comparator: 'eq', value: 'home' },
            ],
        });
    });
});