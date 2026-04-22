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

function evaluateRule(rule: { operator: string; value: string }, sensorValue: number | string | null): boolean {
    if (rule.operator === 'unknown') {
        return sensorValue === null;
    }
    if (rule.operator === 'known') {
        return sensorValue !== null;
    }

    if (rule.operator === 'is' || rule.operator === 'isNot') {
        const matches = String(sensorValue) === rule.value;
        return rule.operator === 'is' ? matches : !matches;
    }
    if (rule.operator === 'oneOf' || rule.operator === 'notOneOf') {
        const matches = rule.value.split(',').map(v => v.trim()).includes(String(sensorValue));
        return rule.operator === 'oneOf' ? matches : !matches;
    }

    const value = parseFloat(rule.value);
    if (isNaN(value)) return false;
    const numValue = typeof sensorValue === 'number' ? sensorValue : parseFloat(String(sensorValue));
    if (isNaN(numValue)) return false;

    switch (rule.operator) {
        case '<': return numValue < value;
        case '<=': return numValue <= value;
        case '>': return numValue > value;
        case '>=': return numValue >= value;
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

describe('evaluateRule - distance operators', () => {
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
});

describe('evaluateRule - state operators', () => {
    it('should evaluate is operator', () => {
        expect(evaluateRule({ operator: 'is', value: 'home' }, 'home')).toBe(true);
        expect(evaluateRule({ operator: 'is', value: 'home' }, 'away')).toBe(false);
    });

    it('should evaluate isNot operator', () => {
        expect(evaluateRule({ operator: 'isNot', value: 'home' }, 'away')).toBe(true);
        expect(evaluateRule({ operator: 'isNot', value: 'home' }, 'home')).toBe(false);
    });

    it('should evaluate oneOf operator', () => {
        expect(evaluateRule({ operator: 'oneOf', value: 'home,work' }, 'home')).toBe(true);
        expect(evaluateRule({ operator: 'oneOf', value: 'home,work' }, 'gym')).toBe(false);
    });

    it('should evaluate notOneOf operator', () => {
        expect(evaluateRule({ operator: 'notOneOf', value: 'home,work' }, 'gym')).toBe(true);
        expect(evaluateRule({ operator: 'notOneOf', value: 'home,work' }, 'home')).toBe(false);
    });

    it('should evaluate unknown operator', () => {
        expect(evaluateRule({ operator: 'unknown', value: '' }, null)).toBe(true);
        expect(evaluateRule({ operator: 'unknown', value: '' }, 'home')).toBe(false);
    });

    it('should evaluate known operator', () => {
        expect(evaluateRule({ operator: 'known', value: '' }, 'home')).toBe(true);
        expect(evaluateRule({ operator: 'known', value: '' }, null)).toBe(false);
    });
});