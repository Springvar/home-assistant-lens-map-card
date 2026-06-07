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

export interface PersonConfig {
    entity_id: string;
    name?: string;
    namedSensors?: PersonSensors;
    displayRules?: DisplayRule[];
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
    colors?: Record<string, string>;
}

export const TRAIL_COLORS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
];