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
    operator: '<' | '<=' | '>' | '>=' | 'is' | 'isNot' | 'oneOf' | 'notOneOf' | 'unknown' | 'known';
    value: string;
    enabled?: boolean;
    description?: string;
}

export interface PersonConfig {
    entity_id: string;
    name?: string;
    namedSensors?: PersonSensors;
    displayRules?: DisplayRule[];
    showOnMap?: boolean;
}

export interface MapConfig {
    type?: 'bw' | 'color' | 'dark' | 'outlines' | 'system';
    opacity?: number;
    api_key?: string;
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