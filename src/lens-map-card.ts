import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import './lens-map-card-editor';
import type { LensMapCardEditor } from './lens-map-card-editor';
import type { PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig, TrailConfig } from './types';

export interface LensMapCardConfig {
    persons: PersonConfig[];
    current_user?: string;
    display_rules?: DisplayRule[];
    map?: MapConfig;
    zoom?: ZoomConfig;
    center?: CenterConfig;
    title?: string;
    show_title?: boolean;
    trail?: TrailConfig;
}

const VALID_MAPS = new Set(['none', 'system', 'bw', 'light', 'color', 'dark', 'voyager', 'satellite', 'topo', 'outlines']);

const TRAIL_COLORS = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
];

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
    @property({ type: Object }) declare trail: TrailConfig;
    @property({ type: String }) declare title: string;
    @property({ type: Boolean }) declare show_title: boolean;

    @state() private _hass: any;
    @state() private _leafletLoaded = false;
    @state() private _leafletMap: any = null;
    @state() private _markers: Map<string, any> = new Map();
    private _resizeObserver: ResizeObserver | null = null;
    private _mapInitRetries = 0;
    private _initScheduled = false;
    private _mapInitialized = false;
    private _positionHistory: Map<string, Array<{ lat: number; lon: number; ts: number }>> = new Map();
    private _trailLayers: Map<string, { polyline: any; circles: any[] }> = new Map();
    private _fetchingHistory = false;

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
            center: { type: 'user' },
            trail: { enabled: false, max_age: 60 },
            title: 'Lens Map',
            show_title: true
        };
    }

    @property({ attribute: false })
    set hass(value: any) {
        const oldHass = this._hass;
        this._hass = value;

        if (!oldHass && value) {
            this._detectCurrentUser();
            this._loadLeaflet();
        } else if (oldHass && value && this._leafletLoaded) {
            if (!this.current_user) {
                this._detectCurrentUser();
            }
            if (this._leafletMap) {
                this._updateTrails();
                this._updateMarkers();
            } else {
                this._scheduleMapInit();
            }
        }

        this.requestUpdate('hass', oldHass);
    }

    get hass() {
        return this._hass;
    }

    private _detectCurrentUser() {
        if (this.current_user || !this._hass?.user?.id) return;
        for (const [entityId, stateObj] of Object.entries(this._hass.states)) {
            if (entityId.startsWith('person.') && (stateObj as any)?.attributes?.user_id === this._hass.user.id) {
                this.current_user = entityId;
                return;
            }
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this._scheduleMapInit();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._initScheduled = false;
        this._clearTrails();
        this._positionHistory.clear();
        this._markers.clear();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._leafletMap) {
            this._leafletMap.remove();
            this._leafletMap = null;
        }
        this._mapInitialized = false;
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
        this.center = config.center || { type: 'user' };
        this.trail = config.trail || { enabled: false, max_age: 60 };
        this.title = config.title || 'Lens Map';
        this.show_title = config.show_title !== false;

        if (this._leafletLoaded) {
            setTimeout(() => {
                this._updateTrails();
                this._updateMarkers();
                this._fetchTrailHistory();
            }, 0);
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
                this._fixLeafletIcons();
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
                    this._fixLeafletIcons();
                    this._scheduleMapInit();
                }
            }, 50);
        }
    }

    private _fixLeafletIcons() {
        delete (window.L.Icon.Default.prototype as any)._getIconUrl;
        window.L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet/dist/images/marker-shadow.png',
        });
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
        const mapCenter = this._getMapCenter();
        const centerLat = mapCenter?.latitude || 0;
        const centerLon = mapCenter?.longitude || 0;
        const zoomLevel = this.zoom?.level ?? 13;

        const interactive = this.map?.interactive !== false;

        this._leafletMap = window.L.map(mapContainer, {
            center: [centerLat, centerLon],
            zoom: zoomLevel,
            zoomControl: interactive,
            dragging: interactive,
            scrollWheelZoom: interactive,
            boxZoom: interactive,
            doubleClickZoom: interactive,
            keyboard: interactive,
            touchZoom: interactive
        });

        this._addTileLayer();
        this._updateTrails();
        this._updateMarkers();
        this._fetchTrailHistory();

        if (this.center?.type === 'visible') {
            this._fitMapToVisibleMarkers();
        }

        this._setupResizeObserver(mapContainer);
        this._mapInitialized = true;
    }

    private _fitMapToVisibleMarkers() {
        if (!this._leafletMap) return;
        const markers = Array.from(this._markers.values());
        if (markers.length === 0) return;

        const group = window.L.featureGroup(markers);
        this._leafletMap.fitBounds(group.getBounds().pad(0.1), { animate: false });
    }

    private _getTrailColor(person: PersonConfig, idx: number): string {
        if (this.trail?.colors?.[person.entity_id]) return this.trail.colors[person.entity_id];
        return TRAIL_COLORS[idx % TRAIL_COLORS.length];
    }

    private async _fetchTrailHistory() {
        if (this._fetchingHistory || !this._hass || !this.persons.length) return;
        this._fetchingHistory = true;

        const maxAge = this.trail?.max_age ?? 60;
        const startTime = new Date(Date.now() - maxAge * 60 * 1000).toISOString();

        const allDeviceTrackers: string[] = [];
        const personTrackers = new Map<string, string[]>();

        for (const person of this.persons) {
            const stateObj = this._hass.states[person.entity_id];
            const trackers: string[] = stateObj?.attributes?.device_trackers || [];
            personTrackers.set(person.entity_id, trackers);
            for (const t of trackers) {
                if (!allDeviceTrackers.includes(t)) allDeviceTrackers.push(t);
            }
        }

        if (allDeviceTrackers.length === 0) {
            this._fetchingHistory = false;
            return;
        }

        try {
            const url = `/api/history/period/${encodeURIComponent(startTime)}?filter_entity_id=${allDeviceTrackers.join(',')}`;
            let result: any[][];

            if (typeof this._hass.callApi === 'function') {
                result = await this._hass.callApi('GET', url);
            } else {
                const headers: Record<string, string> = {
                    'Authorization': `Bearer ${(this._hass as any)?.auth?.access_token || ''}`
                };
                const resp = await fetch(url, { headers, credentials: 'same-origin' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                result = await resp.json();
            }

            const trackerStates = new Map<string, any[]>();
            for (const states of result) {
                if (states.length === 0) continue;
                trackerStates.set(states[0].entity_id, states);
            }

            for (const person of this.persons) {
                const trackers = personTrackers.get(person.entity_id) || [];
                const allPoints: Array<{ lat: number; lon: number; ts: number }> = [];

                for (const trackerId of trackers) {
                    const states = trackerStates.get(trackerId) || [];
                    for (const state of states) {
                        const lat = state.attributes?.latitude;
                        const lon = state.attributes?.longitude;
                        if (typeof lat === 'number' && typeof lon === 'number') {
                            const ts = new Date(state.last_updated || state.last_changed).getTime();
                            if (!isNaN(ts)) {
                                allPoints.push({ lat, lon, ts });
                            }
                        }
                    }
                }

                allPoints.sort((a, b) => a.ts - b.ts);

                const deduped: typeof allPoints = [];
                for (const p of allPoints) {
                    const last = deduped[deduped.length - 1];
                    if (!last || last.lat !== p.lat || last.lon !== p.lon) {
                        deduped.push(p);
                    }
                }

                if (deduped.length > 0) {
                    this._positionHistory.set(person.entity_id, deduped);
                }
            }
        } catch (e) {
            console.error('[LensMap] Failed to fetch trail history:', e);
        }

        this._fetchingHistory = false;
        this._drawTrails();
    }

    private _updateTrails() {
        if (!this._leafletMap || !this._hass) return;
        const enabled = this.trail?.enabled;
        const maxAgeMs = (this.trail?.max_age ?? 60) * 60 * 1000;
        const maxDistance = this.trail?.max_distance ?? parseFloat(this.display_rules?.find(r => r.id === 'default')?.value || '1000');
        const now = Date.now();

        if (!enabled) {
            this._clearTrails();
            return;
        }

        for (const person of this.persons) {
            const location = getLocation(this._hass, person.entity_id);
            if (!location) continue;

            let distOk = true;
            if (maxDistance > 0) {
                const currentUserLoc = this._getCurrentUserLocation();
                if (currentUserLoc) {
                    const d = haversine(currentUserLoc.latitude, currentUserLoc.longitude, location.latitude, location.longitude);
                    if (d > maxDistance) distOk = false;
                }
            }

            let history = this._positionHistory.get(person.entity_id) || [];

            const last = history[history.length - 1];
            const isDuplicate = last && last.lat === location.latitude && last.lon === location.longitude;

            if (!isDuplicate && distOk) {
                history.push({ lat: location.latitude, lon: location.longitude, ts: now });
            }

            history = history.filter(p => (now - p.ts) <= maxAgeMs);
            this._positionHistory.set(person.entity_id, history);
        }

        this._drawTrails();
    }

    private _clearTrails() {
        for (const { polyline, circles } of this._trailLayers.values()) {
            polyline.remove();
            circles.forEach(c => c.remove());
        }
        this._trailLayers.clear();
    }

    private _drawTrails() {
        this._clearTrails();

        const enabled = this.trail?.enabled;
        if (!enabled || !this._leafletMap) return;

        const maxAgeMs = (this.trail?.max_age ?? 60) * 60 * 1000;
        const now = Date.now();

        for (const [idx, person] of this.persons.entries()) {
            const history = this._positionHistory.get(person.entity_id);
            if (!history || history.length < 2) continue;

            const color = this._getTrailColor(person, idx);
            const latlngs: [number, number][] = history.map(p => [p.lat, p.lon]);

            const polyline = window.L.polyline(latlngs, {
                color,
                weight: 3,
                opacity: 0.7
            }).addTo(this._leafletMap);

            const circles = history.map(p => {
                const age = now - p.ts;
                const ratio = Math.max(0, 1 - age / maxAgeMs);
                const opacity = 0.5 + ratio * 0.5;
                const radius = age === 0 ? 6 : 4;
                return window.L.circleMarker([p.lat, p.lon], {
                    radius,
                    color,
                    fillColor: color,
                    fillOpacity: opacity,
                    opacity,
                    weight: 2
                }).addTo(this._leafletMap);
            });

            this._trailLayers.set(person.entity_id, { polyline, circles });
        }
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
        if (this.current_user) {
            return getLocation(this._hass, this.current_user);
        }
        return null;
    }

    private _getMapCenter(): { latitude: number; longitude: number } | null {
        const centerType = this.center?.type || 'user';

        if (centerType === 'user' && this.current_user) {
            return getLocation(this._hass, this.current_user);
        }

        if (centerType === 'home' && this.center?.home_zone) {
            return getLocation(this._hass, this.center.home_zone);
        }

        if (centerType === 'fixed' && this.center?.fixed_coordinates) {
            const { lat, lon } = this.center.fixed_coordinates;
            if (typeof lat === 'number' && typeof lon === 'number') {
                return { latitude: lat, longitude: lon };
            }
        }

        if (centerType === 'visible') {
            return null;
        }

        if (centerType?.startsWith('person:')) {
            const entityId = centerType.slice(7);
            return getLocation(this._hass, entityId);
        }

        const entityId = this.center?.entity_id || this.current_user;
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

    private _createPersonIcon(stateObj: any, name: string): any {
        const pictureUrl = stateObj?.attributes?.entity_picture;
        if (pictureUrl) {
            return window.L.divIcon({
                html: `<img src="${this._hass.hassUrl(pictureUrl)}" style="width:40px;height:40px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);object-fit:cover;" />`,
                iconSize: [40, 40],
                iconAnchor: [20, 20],
                className: ''
            });
        }
        return window.L.divIcon({
            html: `<div style="width:36px;height:36px;border-radius:50%;background:#03a9f4;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold;">${name.charAt(0).toUpperCase()}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            className: ''
        });
    }

    private _updateMarkers() {
        if (!this._leafletMap || !this._hass || !this.persons) return;

        const visible = new Set<string>();
        for (const person of this.persons) {
            const shouldShow = this._evaluatePersonDisplayRules(person);
            if (!shouldShow) continue;
            const location = getLocation(this._hass, person.entity_id);
            if (!location) continue;
            visible.add(person.entity_id);
        }

        for (const [entityId, marker] of this._markers) {
            if (!visible.has(entityId)) {
                marker.remove();
                this._markers.delete(entityId);
            }
        }

        for (const person of this.persons) {
            if (!visible.has(person.entity_id)) continue;

            const location = getLocation(this._hass, person.entity_id);
            const stateObj = this._hass.states[person.entity_id];
            const name = person.name || stateObj?.attributes?.friendly_name || person.entity_id;
            const entityState = stateObj?.state || 'unknown';

            const existing = this._markers.get(person.entity_id);
            if (existing) {
                existing.setLatLng([location.latitude, location.longitude]);
                existing.setPopupContent(`<strong>${name}</strong><br>${entityState}`);
                continue;
            }

            const icon = this._createPersonIcon(stateObj, name);

            const marker = window.L.marker([location.latitude, location.longitude], {
                icon,
                title: name
            }).addTo(this._leafletMap);

            marker.bindPopup(`<strong>${name}</strong><br>${entityState}`);
            this._markers.set(person.entity_id, marker);
        }

        if (this.center?.type === 'visible' && !this._mapInitialized) {
            this._fitMapToVisibleMarkers();
        }
    }

    private _evaluatePersonDisplayRules(person: PersonConfig, _currentLat?: number, _currentLon?: number): boolean {
        const rules = (person.displayRules?.length ? person.displayRules : this.display_rules) || [];
        const enabledRules = rules.filter(r => r.enabled !== false).sort((a, b) => b.priority - a.priority);

        if (enabledRules.length === 0) return true;

        const currentUserLocation = this._getCurrentUserLocation();
        const currentUserLat = currentUserLocation?.latitude;
        const currentUserLon = currentUserLocation?.longitude;

        for (const rule of enabledRules) {
            if (!rule.sensor || !rule.operator || rule.value === undefined) continue;

            let sensorValue: number | string = 0;

            if (rule.sensor === 'distance' && currentUserLat !== undefined && currentUserLon !== undefined) {
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