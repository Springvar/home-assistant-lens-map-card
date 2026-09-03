export interface PersonSensor {
    entity_id: string | string[];
    attribute?: string;
}

export interface PersonSensors {
    [sensorName: string]: PersonSensor;
}

export interface DisplayRule {
    id: string;
    priority: number;
    sensor: string;
    operator: '<' | '<=' | '>' | '>=' | '=' | '!=' | 'oneOf';
    value: string;
    enabled?: boolean;
    description?: string;
}

export type ConditionComparator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'oneOf' | 'notOneOf';

export const BUILT_IN_SENSORS = ['distance', 'distance_from_person', 'distance_from_zone', 'state', 'who', 'where', 'when', 'user', 'random'] as const;
export type BuiltInSensor = typeof BUILT_IN_SENSORS[number];

export const TRAIL_SENSORS = ['distance_from_user', 'distance_from_person', 'distance_from_zone'] as const;
export type TrailSensor = typeof TRAIL_SENSORS[number];

export interface SensorCondition {
    sensor: string;
    comparator: ConditionComparator;
    value: unknown;
    attribute?: string;
    zone?: { lat: number; lon: number };
    target_person?: string;
}

export interface GroupCondition {
    type: 'AND' | 'OR';
    conditions: DisplayCondition[];
}

export interface NotCondition {
    type: 'NOT';
    condition: DisplayCondition;
}

export interface DefaultCondition {
    type: 'DEFAULT';
}

export type DisplayCondition = SensorCondition | GroupCondition | NotCondition | DefaultCondition;

export interface PersonConfig {
    entity_id: string;
    name?: string;
    namedSensors?: PersonSensors;
    displayRules?: DisplayRule[];
    displayConditions?: DisplayCondition[];
    showOnMap?: boolean;
}

/** A concrete, selectable map provider (excludes the special 'none'/'system' values). */
export type MapType = 'bw' | 'light' | 'color' | 'dark' | 'voyager' | 'satellite' | 'topo' | 'outlines';

export interface MapConfig {
    type?: 'none' | 'system' | MapType;
    /**
     * Per-theme overrides used when `type === 'system'`.
     * `light` (default `color`) and `dark` (default `dark`) pick which map is
     * shown for each theme, each able to carry its own API key.
     */
    light?: MapType;
    dark?: MapType;
    opacity?: number;
    api_key?: string;
    light_api_key?: string;
    dark_api_key?: string;
    interactive?: boolean;
}

export interface ZoomConfig {
    level?: number;
    auto_level?: boolean | 'zoom_out';
}

export interface CenterConfig {
    type?: 'user' | 'visible' | 'home' | 'fixed' | 'person';
    entity_id?: string;
    use_current_user?: boolean;
    home_zone?: string;
    fixed_coordinates?: { lat: number; lon: number };
}

export interface TrailConfig {
    enabled?: boolean;
    max_age?: number;
    conditions?: DisplayCondition[];
    person_conditions?: Record<string, DisplayCondition[]>;
    gps_jump_filter?: boolean;
    newest_opacity?: number;
    oldest_opacity?: number;
    midpoint?: number;
    colors?: Record<string, string>;
}

export const TRAIL_COLORS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
];

const OPERATOR_MAP: Record<string, ConditionComparator> = {
    '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte', '=': 'eq', '!=': 'ne', 'oneOf': 'oneOf'
};

export function migrateDisplayRule(rule: DisplayRule): SensorCondition {
    return {
        sensor: rule.sensor,
        comparator: OPERATOR_MAP[rule.operator] || 'eq',
        value: rule.value,
    };
}

export function migrateDisplayRules(rules: DisplayRule[]): DisplayCondition[] {
    const enabled = rules.filter(r => r.enabled !== false);
    if (enabled.length === 0) return [];
    if (enabled.length === 1) return [migrateDisplayRule(enabled[0])];
    const conditions: GroupCondition = {
        type: 'AND',
        conditions: enabled.map(migrateDisplayRule),
    };
    return [conditions];
}

export function migrateTrailConfig(trail: TrailConfig & Record<string, any>): TrailConfig {
    const result: TrailConfig = { ...trail };

    if (result.max_distance !== undefined || result.proximity !== undefined) {
        const conds: DisplayCondition[] = [];

        if (result.max_distance !== undefined) {
            conds.push({ sensor: 'distance_from_user', comparator: 'lte', value: result.max_distance });
        }

        if (result.proximity !== undefined && result.proximity > 0) {
            const proximityCondition: DisplayCondition = {
                sensor: 'distance_from_person',
                comparator: 'gt',
                value: result.proximity,
            };
            if (conds.length > 0) {
                conds.push(proximityCondition);
            } else {
                conds.push(proximityCondition);
            }
        }

        if (conds.length === 1) {
            result.conditions = conds;
        } else if (conds.length > 1) {
            result.conditions = [{ type: 'AND', conditions: conds }];
        }

        delete result.max_distance;
        delete result.proximity;
    }

    return result;
}