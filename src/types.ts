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

export const BUILT_IN_SENSORS = ['distance', 'state', 'who', 'where', 'when', 'user', 'random'] as const;
export type BuiltInSensor = typeof BUILT_IN_SENSORS[number];

export interface SensorCondition {
    sensor: string;
    comparator: ConditionComparator;
    value: unknown;
    attribute?: string;
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

export interface MapConfig {
    type?: 'none' | 'system' | 'bw' | 'light' | 'color' | 'dark' | 'voyager' | 'satellite' | 'topo' | 'outlines';
    opacity?: number;
    api_key?: string;
    interactive?: boolean;
}

export interface ZoomConfig {
    level?: number;
    auto_level?: boolean;
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
    max_distance?: number;
    proximity?: number;
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