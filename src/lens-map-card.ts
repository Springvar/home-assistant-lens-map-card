import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import './lens-map-card-editor';
import type { LensMapCardEditor } from './lens-map-card-editor';
import type { PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig } from './types';

export interface LensMapCardConfig {
    persons: PersonConfig[];
    current_user?: string;
    display_rules?: DisplayRule[];
    map?: MapConfig;
    zoom?: ZoomConfig;
    center?: CenterConfig;
    title?: string;
    show_title?: boolean;
}

const VALID_MAPS = new Set(['bw', 'color', 'dark', 'outlines', 'system']);

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

function evaluateRule(rule: DisplayRule, sensorValue: number | string | null): boolean {
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

class LensMapCard extends LitElement {
    @property({ type: Array }) declare persons: PersonConfig[];
    @property({ type: String }) declare current_user: string;
    @property({ type: Array }) declare display_rules: DisplayRule[];
    @property({ type: Object }) declare map: MapConfig;
    @property({ type: Object }) declare zoom: ZoomConfig;
    @property({ type: Object }) declare center: CenterConfig;
    @property({ type: String }) declare title: string;
    @property({ type: Boolean }) declare show_title: boolean;

    @state() private _hass: any;
    @state() private _leafletLoaded = false;
    @state() private _leafletMap: any = null;
    @state() private _markers: Map<string, any> = new Map();

    static async getConfigElement(config: LensMapCardConfig) {
        await import('./lens-map-card-editor');
        const el = document.createElement('lens-map-card-editor') as LensMapCardEditor;
        el.setConfig(config);
        return el;
    }

    static getConfigElementStatic(config: LensMapCardConfig) {
        const el = document.createElement('lens-map-card-editor') as LensMapCardEditor;
        el.setConfig(config);
        return el;
    }

    static getStubConfig(hass: any) {
        const persons = Object.keys(hass.states)
            .filter((eid) => eid.startsWith('person.'))
            .slice(0, 2)
            .map((eid) => ({ entity_id: eid }));
        return {
            persons,
            current_user: persons[0]?.entity_id || '',
            display_rules: [{ id: 'default', priority: 1, sensor: 'distance', operator: '<', value: '1000', enabled: true }],
            map: { type: 'color' },
            zoom: { level: 10 },
            center: { use_current_user: true },
            title: 'Lens Map',
            show_title: true
        };
    }

    @property({ attribute: false })
    set hass(value: any) {
        const oldHass = this._hass;
        this._hass = value;

        if (!oldHass && value) {
            this._loadLeaflet();
        }

        if (oldHass && value && this._leafletLoaded) {
            this._updateMarkers();
        }

        this.requestUpdate('hass', oldHass);
    }

    get hass() {
        return this._hass;
    }

    setConfig(config: LensMapCardConfig) {
        this.persons = config.persons || [];
        this.current_user = config.current_user || '';
        this.display_rules = config.display_rules || [
            { id: 'default', priority: 1, sensor: 'distance', operator: '<', value: '1000', enabled: true }
        ];
        this.map = config.map || { type: 'color', opacity: 1 };
        this.zoom = config.zoom || { level: 10, auto_level: false };
        this.center = config.center || { use_current_user: true };
        this.title = config.title || 'Lens Map';
        this.show_title = config.show_title !== false;

        if (this._leafletLoaded) {
            setTimeout(() => this._updateMarkers(), 0);
        }
    }

    private async _loadLeaflet() {
        if (typeof window === 'undefined') return;

        if (window.L) {
            this._leafletLoaded = true;
            this._initLeafletMap();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet/dist/leaflet.css';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet/dist/leaflet.js';
        script.onload = () => {
            this._leafletLoaded = true;
            this._initLeafletMap();
        };
        document.head.appendChild(script);
    }

    private _initLeafletMap() {
        if (!window.L || !this._hass) return;

        const mapContainer = this.shadowRoot?.getElementById('map-container') as HTMLElement;
        if (!mapContainer) return;

        const currentUserLocation = this._getCurrentUserLocation();
        const centerLat = currentUserLocation?.latitude || 0;
        const centerLon = currentUserLocation?.longitude || 0;
        const zoomLevel = this.zoom?.level ?? 13;

        if (this._leafletMap) {
            this._leafletMap.remove();
        }

        this._leafletMap = window.L.map(mapContainer, {
            center: [centerLat, centerLon],
            zoom: zoomLevel,
            zoomControl: true,
            dragging: true,
            scrollWheelZoom: true
        });

        this._addTileLayer();
        this._updateMarkers();
    }

    private _getCurrentUserLocation(): { latitude: number; longitude: number } | null {
        const entityId = this.center?.entity_id || this.current_user;
        if (this.center?.use_current_user && this.current_user) {
            return getLocation(this._hass, this.current_user);
        }
        if (entityId) {
            return getLocation(this._hass, entityId);
        }
        return null;
    }

    private _addTileLayer() {
        if (!this._leafletMap || !this.map) return;

        const type = this.map.type || 'color';
        const TILE_LAYERS: Record<string, [string, any]> = {
            bw: ['https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png', { attribution: 'Map tiles by Staden Design' }],
            color: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', subdomains: ['a', 'b', 'c'] }],
            dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB' }],
            outlines: ['https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png', { attribution: 'Map tiles by Staden Design' }],
            system: ['', {}]
        };

        let resolvedType = type;
        if (type === 'system') {
            try {
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                const haDark = window.parent?.document?.body?.classList.contains('dark');
                resolvedType = haDark || prefersDark ? 'dark' : 'color';
            } catch {
                resolvedType = 'color';
            }
        }

        const [url, opts] = TILE_LAYERS[resolvedType] || TILE_LAYERS.color;
        if (url && this.map.api_key) {
            this._leafletMap.addLayer(window.L.tileLayer(url + '?api_key=' + this.map.api_key, opts));
        } else if (url) {
            this._leafletMap.addLayer(window.L.tileLayer(url, opts));
        }
    }

    private _updateMarkers() {
        if (!this._leafletMap || !this._hass || !this.persons) return;

        this._markers.forEach(marker => marker.remove());
        this._markers.clear();

        const currentUserLocation = this._getCurrentUserLocation();
        const currentLat = currentUserLocation?.latitude;
        const currentLon = currentUserLocation?.longitude;

        for (const person of this.persons) {
            const shouldShow = this._evaluatePersonDisplayRules(person, currentLat, currentLon);
            if (!shouldShow) continue;

            const location = getLocation(this._hass, person.entity_id);
            if (!location) continue;

            const name = person.name || this._hass.states[person.entity_id]?.attributes?.friendly_name || person.entity_id;
            const entityState = this._hass.states[person.entity_id]?.state || 'unknown';

            const marker = window.L.marker([location.latitude, location.longitude], {
                title: name
            }).addTo(this._leafletMap);

            marker.bindPopup(`<strong>${name}</strong><br>${entityState}`);
            this._markers.set(person.entity_id, marker);
        }
    }

    private _evaluatePersonDisplayRules(person: PersonConfig, currentLat?: number, currentLon?: number): boolean {
        const rules = person.displayRules || this.display_rules || [];
        const enabledRules = rules.filter(r => r.enabled !== false).sort((a, b) => b.priority - a.priority);

        if (enabledRules.length === 0) return true;

        const currentUserLocation = this._getCurrentUserLocation();
        const currentUserLat = currentUserLocation?.latitude;
        const currentUserLon = currentUserLocation?.longitude;

        for (const rule of enabledRules) {
            if (!rule.sensor || !rule.operator || rule.value === undefined) continue;

            let sensorValue: number | string = 0;

            if (rule.sensor === 'distance' && currentUserLat !== undefined && currentLon !== undefined) {
                const personLocation = getLocation(this._hass, person.entity_id);
                if (personLocation) {
                    sensorValue = haversine(currentUserLat, currentUserLon, personLocation.latitude, personLocation.longitude);
                }
            } else if (person.namedSensors?.[rule.sensor]) {
                const sensor = person.namedSensors[rule.sensor];
                const entityId = Array.isArray(sensor.entity_id) ? sensor.entity_id[0] : sensor.entity_id;
                if (sensor.attribute) {
                    sensorValue = getEntityAttr(this._hass, entityId, sensor.attribute);
                } else {
                    const state = getEntityState(this._hass, entityId);
                    sensorValue = isNaN(parseFloat(state)) ? state : parseFloat(state);
                }
            } else {
                const entityState = getEntityState(this._hass, person.entity_id);
                sensorValue = isNaN(parseFloat(entityState)) ? entityState : parseFloat(entityState);
            }

            if (!evaluateRule(rule, sensorValue)) {
                return false;
            }
        }

        return true;
    }

    render() {
        return html`
            <ha-card>
                ${this.show_title ? html`<div class="card-header">${this.title}</div>` : ''}
                <div id="map-container" class="map-container"></div>
            </ha-card>
        `;
    }

    static styles = css`
        ha-card {
            display: block;
            padding: 16px;
        }
        .card-header {
            font-weight: bold;
            font-size: 1.2em;
            margin-bottom: 10px;
        }
        .map-container {
            height: 400px;
            width: 100%;
            border-radius: 8px;
            overflow: hidden;
        }
    `;
}

customElements.define('lens-map-card', LensMapCard);

if (typeof window !== 'undefined') {
    (window as any).customCards = (window as any).customCards || [];
    (window as any).customCards.push({
        type: 'lens-map-card',
        name: 'Lens Map Card',
        preview: false,
        description: 'A map card showing persons based on configurable display rules.'
    });
}