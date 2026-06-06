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

const VALID_MAPS = new Set(['none', 'system', 'bw', 'light', 'color', 'dark', 'voyager', 'satellite', 'topo', 'outlines']);

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

function evaluateRule(rule: DisplayRule, sensorValue: number | string): boolean {
    const value = parseFloat(rule.value);
    if (isNaN(value)) {
        if (rule.operator === '=') return String(sensorValue) === rule.value;
        if (rule.operator === '!=') return String(sensorValue) !== rule.value;
        if (rule.operator === 'oneOf') return rule.value.split(',').map(v => v.trim()).includes(String(sensorValue));
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
    private _resizeObserver: ResizeObserver | null = null;
    private _mapInitRetries = 0;
    private _initScheduled = false;

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

    static getStubConfig(_hass: any) {
        return {
            persons: [],
            current_user: '',
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
        } else if (oldHass && value && this._leafletLoaded) {
            this._updateMarkers();
        }

        this.requestUpdate('hass', oldHass);
    }

    get hass() {
        return this._hass;
    }

    connectedCallback() {
        super.connectedCallback();
        this._scheduleMapInit();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._initScheduled = false;
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._leafletMap) {
            this._leafletMap.remove();
            this._leafletMap = null;
        }
    }

    firstUpdated() {
        this._scheduleMapInit();
    }

    setConfig(config: LensMapCardConfig) {
        config = config || {};
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

    private _loadLeaflet() {
        if (typeof window === 'undefined' || this._leafletLoaded) return;

        if (window.L) {
            this._leafletLoaded = true;
            this._scheduleMapInit();
            return;
        }

        if (!document.getElementById('leaflet-js-loader')) {
            const script = document.createElement('script');
            script.id = 'leaflet-js-loader';
            script.src = 'https://unpkg.com/leaflet/dist/leaflet.js';
            script.onload = () => {
                this._leafletLoaded = true;
                this._scheduleMapInit();
            };
            script.onerror = () => {
                script.remove();
                console.error('[LensMap] Leaflet script load failed');
            };
            document.head.appendChild(script);
        } else {
            const poll = setInterval(() => {
                if (window.L) {
                    clearInterval(poll);
                    this._leafletLoaded = true;
                    this._scheduleMapInit();
                }
            }, 50);
        }
    }

    private _scheduleMapInit() {
        if (this._leafletMap || this._initScheduled) return;
        this._initScheduled = true;
        this._tryInitMap();
    }

    private _tryInitMap() {
        if (!window.L || !this._hass) {
            this._initScheduled = false;
            return;
        }

        const mapContainer = this.shadowRoot?.getElementById('map-container') as HTMLElement;
        if (!mapContainer || mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
            if (this._mapInitRetries < 100) {
                this._mapInitRetries++;
                requestAnimationFrame(() => this._tryInitMap());
            } else {
                this._initScheduled = false;
            }
            return;
        }

        this._mapInitRetries = 0;
        this._initScheduled = false;
        this._initLeafletMap(mapContainer);
    }

    private _initLeafletMap(mapContainer: HTMLElement) {
        const currentUserLocation = this._getCurrentUserLocation();
        const centerLat = currentUserLocation?.latitude || 0;
        const centerLon = currentUserLocation?.longitude || 0;
        const zoomLevel = this.zoom?.level ?? 13;

        this._leafletMap = window.L.map(mapContainer, {
            center: [centerLat, centerLon],
            zoom: zoomLevel,
            zoomControl: true,
            dragging: true,
            scrollWheelZoom: true
        });

        this._addTileLayer();
        this._updateMarkers();
        this._setupResizeObserver(mapContainer);
    }

    private _setupResizeObserver(container: HTMLElement) {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._resizeObserver = new ResizeObserver(() => {
            try {
                if (this._leafletMap) {
                    requestAnimationFrame(() => {
                        try {
                            this._leafletMap.invalidateSize({ pan: false });
                        } catch (e) {
                            console.error('[LensMap] invalidateSize error:', e);
                        }
                    });
                }
            } catch (e) {
                console.error('[LensMap] ResizeObserver error:', e);
            }
        });
        this._resizeObserver.observe(container);
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
        if (this.map.type === 'none') return;

        const type = this.map.type || 'color';
        const TILE_LAYERS: Record<string, [string, any]> = {
            bw: ['https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png', { attribution: 'Map tiles by Stamen Design, CC BY 3.0' }],
            light: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB, &copy; OpenStreetMap', subdomains: ['a', 'b', 'c', 'd'] }],
            color: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', subdomains: ['a', 'b', 'c'] }],
            dark: ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB, &copy; OpenStreetMap', subdomains: ['a', 'b', 'c', 'd'] }],
            voyager: ['https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { attribution: '&copy; CartoDB, &copy; OpenStreetMap', subdomains: ['a', 'b', 'c', 'd'] }],
            satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri, Maxar, Earthstar Geographics' }],
            topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap, &copy; OpenStreetMap', subdomains: ['a', 'b', 'c'] }],
            outlines: ['https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}.png', { attribution: 'Map tiles by Stamen Design, hosted by Stadia Maps' }],
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

        const config = TILE_LAYERS[resolvedType];
        if (!config) return;
        const [url, opts] = config;
        let tileLayer: any;
        if (url && this.map.api_key) {
            tileLayer = window.L.tileLayer(url + '?api_key=' + this.map.api_key, opts);
        } else if (url) {
            tileLayer = window.L.tileLayer(url, opts);
        } else {
            return;
        }
        if (this.map.opacity != null) {
            tileLayer.setOpacity(this.map.opacity);
        }
        this._leafletMap.addLayer(tileLayer);
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
            <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css">
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
        preview: true,
        description: 'A map card showing persons based on configurable display rules.'
    });
}