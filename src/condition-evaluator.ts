import type { DisplayCondition, SensorCondition, GroupCondition, NotCondition, DefaultCondition, PersonConfig, PersonSensors } from './types';

export interface TrailPointContext {
    point: { lat: number; lon: number };
    personLocation: { latitude: number; longitude: number } | null;
    userLocation: { latitude: number; longitude: number } | null;
    hass: any;
    person: PersonConfig;
}

function isSensorCondition(c: DisplayCondition): c is SensorCondition {
    return c != null && 'sensor' in c && !('type' in c);
}

function isGroupCondition(c: DisplayCondition): c is GroupCondition {
    return c != null && 'type' in c && 'conditions' in c;
}

function isNotCondition(c: DisplayCondition): c is NotCondition {
    return c != null && 'type' in c && 'condition' in c;
}

function isDefaultCondition(c: DisplayCondition): c is DefaultCondition {
    return c != null && 'type' in c && c.type === 'DEFAULT';
}

function getEntityState(hass: any, entityId: string): string {
    return hass?.states[entityId]?.state || 'unavailable';
}

function getEntityAttr(hass: any, entityId: string, attr: string): any {
    return hass?.states[entityId]?.attributes?.[attr];
}

function getLocation(hass: any, entityId: string): { latitude: number; longitude: number } | null {
    const entity = hass?.states[entityId];
    if (!entity) return null;
    const lat = entity.attributes?.latitude;
    const lon = entity.attributes?.longitude;
    if (typeof lat === 'number' && typeof lon === 'number') {
        return { latitude: lat, longitude: lon };
    }
    return null;
}

function getDataAgeMinutes(hass: any, entityId: string): number {
    const entity = hass?.states[entityId];
    if (!entity) return Infinity;
    const lastChanged = entity.last_changed || entity.last_updated;
    if (!lastChanged) return Infinity;
    const timestamp = new Date(lastChanged).getTime();
    if (isNaN(timestamp)) return Infinity;
    return (Date.now() - timestamp) / 60000;
}

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

function matchesWhen(expected: unknown): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;

    const values = Array.isArray(expected) ? expected : typeof expected === 'string' ? expected.split(',').map(v => v.trim()) : [String(expected)];

    return values.some(v => {
        switch (v) {
            case 'night': return hour >= 0 && hour < 6;
            case 'morning': return hour >= 6 && hour < 12;
            case 'afternoon': return hour >= 12 && hour < 18;
            case 'evening': return hour >= 18 && hour < 24;
            case 'weekday': return !isWeekend;
            case 'weekend': return isWeekend;
            default: return false;
        }
    });
}

function personMatchesValue(hass: any, person: PersonConfig, value: string): boolean {
    const personName = person.name || '';
    const friendlyName = hass?.states[person.entity_id]?.attributes?.friendly_name || '';
    const shortId = person.entity_id.replace(/^person\./, '');
    return person.entity_id === value || shortId === value || personName === value || friendlyName === value;
}

function matchesWho(hass: any, person: PersonConfig, expected: unknown, comparator: string): boolean {
    const values = Array.isArray(expected) ? expected.map(String) : typeof expected === 'string' ? expected.split(',').map(v => v.trim()) : [String(expected)];
    const matched = values.some(v => personMatchesValue(hass, person, v));
    if (comparator === 'eq') return matched;
    if (comparator === 'ne') return !matched;
    if (comparator === 'oneOf') return matched;
    if (comparator === 'notOneOf') return !matched;
    return matched;
}

function userMatchesValue(hass: any, person: PersonConfig, value: string): boolean {
    const userId = hass?.user?.id;
    const userName = hass?.user?.name;
    if (value === 'user') {
        const personUserId = hass?.states[person.entity_id]?.attributes?.user_id;
        return personUserId === userId;
    }
    if (value === userId || value === userName) return true;
    const targetUserId = hass?.states[value]?.attributes?.user_id;
    if (targetUserId && targetUserId === userId) return true;
    return false;
}

function matchesUser(hass: any, person: PersonConfig, expected: unknown, comparator: string): boolean {
    const values = Array.isArray(expected) ? expected.map(String) : typeof expected === 'string' ? expected.split(',').map(v => v.trim()) : [String(expected)];
    const matched = values.some(v => userMatchesValue(hass, person, v));
    if (comparator === 'eq') return matched;
    if (comparator === 'ne') return !matched;
    if (comparator === 'oneOf') return matched;
    if (comparator === 'notOneOf') return !matched;
    return matched;
}

function resolveSensorValue(hass: any, person: PersonConfig, currentUserLocation: { latitude: number; longitude: number } | null, sensorKey: string, attribute?: string, condition?: SensorCondition): number | string {
    if (sensorKey === 'distance') {
        if (!currentUserLocation) return Infinity;
        const personLocation = getLocation(hass, person.entity_id);
        if (!personLocation) return Infinity;
        return haversine(currentUserLocation.latitude, currentUserLocation.longitude, personLocation.latitude, personLocation.longitude);
    }

    if (sensorKey === 'distance_from_person') {
        const targetId = condition?.target_person === 'self' ? person.entity_id : condition?.target_person;
        if (!targetId) return Infinity;
        const fromLocation = getLocation(hass, person.entity_id);
        const toLocation = getLocation(hass, targetId);
        if (!fromLocation || !toLocation) return Infinity;
        return haversine(fromLocation.latitude, fromLocation.longitude, toLocation.latitude, toLocation.longitude);
    }

    if (sensorKey === 'distance_from_zone') {
        if (!condition?.zone) return Infinity;
        const personLocation = getLocation(hass, person.entity_id);
        if (!personLocation) return Infinity;
        return haversine(personLocation.latitude, personLocation.longitude, condition.zone.lat, condition.zone.lon);
    }

    if (sensorKey === 'state') {
        const state = getEntityState(hass, person.entity_id);
        return isNaN(parseFloat(state)) ? state : parseFloat(state);
    }

    if (sensorKey === 'data_age') {
        return getDataAgeMinutes(hass, person.entity_id);
    }

    const namedSensor = person.namedSensors?.[sensorKey];
    if (namedSensor) {
        const entityId = Array.isArray(namedSensor.entity_id) ? namedSensor.entity_id[0] : namedSensor.entity_id;
        const attr = attribute || namedSensor.attribute;
        if (attr) {
            const val = getEntityAttr(hass, entityId, attr);
            return val !== undefined ? val : '';
        }
        const state = getEntityState(hass, entityId);
        return isNaN(parseFloat(state)) ? state : parseFloat(state);
    }

    const state = getEntityState(hass, person.entity_id);
    return isNaN(parseFloat(state)) ? state : parseFloat(state);
}

function matchesComparator(actual: unknown, comparator: string, expected: unknown): boolean {
    const actualStr = String(actual);

    switch (comparator) {
        case 'eq': return actualStr === String(expected);
        case 'ne': return actualStr !== String(expected);
        case 'lt': return Number(actual) < Number(expected);
        case 'lte': return Number(actual) <= Number(expected);
        case 'gt': return Number(actual) > Number(expected);
        case 'gte': return Number(actual) >= Number(expected);
        case 'oneOf': {
            const expectedArray = Array.isArray(expected)
                ? expected.map(String)
                : typeof expected === 'string'
                    ? expected.split(',').map(v => v.trim())
                    : [String(expected)];
            return expectedArray.includes(actualStr);
        }
        case 'notOneOf': {
            const expectedArray = Array.isArray(expected)
                ? expected.map(String)
                : typeof expected === 'string'
                    ? expected.split(',').map(v => v.trim())
                    : [String(expected)];
            return !expectedArray.includes(actualStr);
        }
        default: return false;
    }
}

function evaluateSensorCondition(hass: any, person: PersonConfig, currentUserLocation: { latitude: number; longitude: number } | null, condition: SensorCondition): boolean {
    const { sensor, comparator, value, attribute } = condition;

    if (sensor === 'when') {
        return matchesWhen(value);
    }

    if (sensor === 'who') {
        return matchesWho(hass, person, value, comparator);
    }

    if (sensor === 'user') {
        return matchesUser(hass, person, value, comparator);
    }

    if (sensor === 'random') {
        const probability = Number(value) > 1 ? Number(value) / 100 : Number(value);
        return Math.random() < probability;
    }

    const sensorValue = resolveSensorValue(hass, person, currentUserLocation, sensor, attribute, condition);
    return matchesComparator(sensorValue, comparator, value);
}

function evaluateCondition(hass: any, person: PersonConfig, currentUserLocation: { latitude: number; longitude: number } | null, condition: DisplayCondition, defaultConditions?: DisplayCondition[]): boolean {
    if (isGroupCondition(condition)) {
        if (condition.type === 'AND') {
            return condition.conditions.every(c => evaluateCondition(hass, person, currentUserLocation, c, defaultConditions));
        }
        if (condition.type === 'OR') {
            return condition.conditions.some(c => evaluateCondition(hass, person, currentUserLocation, c, defaultConditions));
        }
        return false;
    }

    if (isNotCondition(condition)) {
        return !evaluateCondition(hass, person, currentUserLocation, condition.condition, defaultConditions);
    }

    if (isDefaultCondition(condition)) {
        if (!defaultConditions || defaultConditions.length === 0) return true;
        return defaultConditions.every(c => evaluateCondition(hass, person, currentUserLocation, c, defaultConditions));
    }

    if (isSensorCondition(condition)) {
        return evaluateSensorCondition(hass, person, currentUserLocation, condition);
    }

    return false;
}

export function evaluateConditions(
    hass: any,
    person: PersonConfig,
    currentUserLocation: { latitude: number; longitude: number } | null,
    conditions: DisplayCondition | DisplayCondition[],
    defaultConditions?: DisplayCondition[]
): boolean {
    if (Array.isArray(conditions)) {
        if (conditions.length === 0) return true;
        return conditions.every(c => evaluateCondition(hass, person, currentUserLocation, c, defaultConditions));
    }
    return evaluateCondition(hass, person, currentUserLocation, conditions, defaultConditions);
}

export function extractDistanceThreshold(conditions: DisplayCondition[]): number | null {
    for (const c of conditions) {
        if (isSensorCondition(c) && c.sensor === 'distance' && (c.comparator === 'lt' || c.comparator === 'lte')) {
            return Number(c.value);
        }
        if (isGroupCondition(c)) {
            const found = extractDistanceThreshold(c.conditions);
            if (found !== null) return found;
        }
    }
    return null;
}

function resolveTrailPointSensorValue(ctx: TrailPointContext, sensorKey: string, condition?: SensorCondition): number | string {
    if (sensorKey === 'distance_from_user') {
        if (!ctx.userLocation) return Infinity;
        return haversine(ctx.userLocation.latitude, ctx.userLocation.longitude, ctx.point.lat, ctx.point.lon);
    }

    if (sensorKey === 'distance_from_person') {
        if (!ctx.personLocation) return Infinity;
        return haversine(ctx.personLocation.latitude, ctx.personLocation.longitude, ctx.point.lat, ctx.point.lon);
    }

    if (sensorKey === 'distance_from_zone') {
        if (!condition?.zone) return Infinity;
        return haversine(condition.zone.lat, condition.zone.lon, ctx.point.lat, ctx.point.lon);
    }

    return resolveSensorValue(ctx.hass, ctx.person, ctx.userLocation, sensorKey, condition?.attribute, condition);
}

function evaluateTrailPointSensorCondition(ctx: TrailPointContext, condition: SensorCondition): boolean {
    const { sensor, comparator, value, attribute } = condition;

    if (sensor === 'when') return matchesWhen(value);
    if (sensor === 'who') return matchesWho(ctx.hass, ctx.person, value, comparator);
    if (sensor === 'user') return matchesUser(ctx.hass, ctx.person, value, comparator);
    if (sensor === 'random') {
        const probability = Number(value) > 1 ? Number(value) / 100 : Number(value);
        return Math.random() < probability;
    }

    const sensorValue = resolveTrailPointSensorValue(ctx, sensor, condition);
    return matchesComparator(sensorValue, comparator, value);
}

function evaluateTrailPointCondition(ctx: TrailPointContext, condition: DisplayCondition, defaultConditions?: DisplayCondition[]): boolean {
    if (isGroupCondition(condition)) {
        if (condition.type === 'AND') return condition.conditions.every(c => evaluateTrailPointCondition(ctx, c, defaultConditions));
        if (condition.type === 'OR') return condition.conditions.some(c => evaluateTrailPointCondition(ctx, c, defaultConditions));
        return false;
    }
    if (isNotCondition(condition)) {
        return !evaluateTrailPointCondition(ctx, condition.condition, defaultConditions);
    }
    if (isDefaultCondition(condition)) {
        if (!defaultConditions || defaultConditions.length === 0) return true;
        return defaultConditions.every(c => evaluateTrailPointCondition(ctx, c, defaultConditions));
    }
    if (isSensorCondition(condition)) {
        return evaluateTrailPointSensorCondition(ctx, condition);
    }
    return false;
}

export function evaluateTrailPointConditions(
    ctx: TrailPointContext,
    conditions: DisplayCondition | DisplayCondition[],
    defaultConditions?: DisplayCondition[]
): boolean {
    if (Array.isArray(conditions)) {
        if (conditions.length === 0) return true;
        return conditions.every(c => evaluateTrailPointCondition(ctx, c, defaultConditions));
    }
    return evaluateTrailPointCondition(ctx, conditions, defaultConditions);
}

export { isSensorCondition, isGroupCondition, isNotCondition, isDefaultCondition };
