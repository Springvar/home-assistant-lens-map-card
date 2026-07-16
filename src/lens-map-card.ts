import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import './lens-map-card-editor';
import type { LensMapCardEditor } from './lens-map-card-editor';
import type { PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig, DisplayCondition } from './types';
import { TrailConfig, TRAIL_COLORS, migrateDisplayRules, migrateTrailConfig } from './types';
import { evaluateConditions, extractDistanceThreshold, evaluateTrailPointConditions, type TrailPointContext } from './condition-evaluator';

export interface LensMapCardConfig {
    persons: PersonConfig[];
    current_user?: string;
    display_rules?: DisplayRule[];
    displayConditions?: DisplayCondition[];
    map?: MapConfig;
    zoom?: ZoomConfig;
    center?: CenterConfig;
    title?: string;
    show_title?: boolean;
    trail?: TrailConfig;
    show_auto_zoom?: boolean;
    show_toggle_buttons?: boolean;
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
    @property({ type: Array }) declare displayConditions: DisplayCondition[];
    @property({ type: Object }) declare map: MapConfig;
    @property({ type: Object }) declare zoom: ZoomConfig;
    @property({ type: Object }) declare center: CenterConfig;
    @property({ type: Object }) declare trail: TrailConfig;
    @property({ type: String }) declare title: string;
    @property({ type: Boolean }) declare show_title: boolean;
    @property({ type: Boolean }) declare show_auto_zoom: boolean;
    @property({ type: Boolean }) declare show_toggle_buttons: boolean;

    @state() private _hass: any;
    @state() private _leafletLoaded = false;
    @state() private _leafletMap: any = null;
    @state() private _markers: Map<string, any> = new Map();
    private _resizeObserver: ResizeObserver | null = null;
    private _mapInitRetries = 0;
    private _initScheduled = false;
    private _mapInitialized = false;
    private _positionHistory: Map<string, Array<{ lat: number; lon: number; ts: number }>> = new Map();
    private _trailLayers: Map<string, { polylines: any[]; circles: any[] }> = new Map();
    private _fetchingHistory = false;
    private _lastCenterPos: { lat: number; lng: number } | null = null;
    @state() private _hiddenPersons: Set<string> = new Set();
    @state() private _autoZoomMode: 'off' | 'fit' | 'zoom_out' = 'off';

    private get _effectiveAutoZoom(): boolean {
        return this._autoZoomMode !== 'off';
    }

    private get _isZoomOutOnly(): boolean {
        return this._autoZoomMode === 'zoom_out';
    }

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
            displayConditions: [{ sensor: 'distance', comparator: 'lt', value: '1000' }],
            map: { type: 'color' },
            zoom: { level: 10 },
            center: { type: 'user' },
            trail: { enabled: false, max_age: 60 },
            title: 'Lens Map',
            show_title: true,
            show_auto_zoom: true,
            show_toggle_buttons: true
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
                this._recenterMap();
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
        this._lastCenterPos = null;
    }

    firstUpdated() {
        this._scheduleMapInit();
    }

    setConfig(config: LensMapCardConfig) {
        config = config || {};

        const migratedPersons = (config.persons || []).map(p => {
            const person = { ...p };
            if (!person.displayConditions && person.displayRules) {
                person.displayConditions = migrateDisplayRules(person.displayRules);
            }
            return person;
        });

        this.persons = migratedPersons;
        this.current_user = config.current_user || '';
        this.display_rules = config.display_rules || [
            { id: 'default', priority: 1, sensor: 'distance', operator: '<', value: '1000', enabled: true }
        ];

        if (config.displayConditions) {
            this.displayConditions = config.displayConditions;
        } else if (config.display_rules) {
            this.displayConditions = migrateDisplayRules(this.display_rules);
        } else {
            this.displayConditions = [{ sensor: 'distance', comparator: 'lt', value: '1000' }];
        }

        this.map = config.map || { type: 'color', opacity: 1 };
        this.zoom = config.zoom || { level: 10, auto_level: false };
        this.center = config.center || { type: 'user' };
        this.trail = migrateTrailConfig(config.trail || { enabled: false, max_age: 60 });
        this.title = config.title || 'Lens Map';
        this.show_title = config.show_title !== false;
        this.show_auto_zoom = config.show_auto_zoom !== false;
        this.show_toggle_buttons = config.show_toggle_buttons !== false;
        this._autoZoomMode = this.zoom?.auto_level === true ? 'fit'
            : this.zoom?.auto_level === 'zoom_out' ? 'zoom_out'
            : 'off';

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
        const centerLat = mapCenter?.latitude ?? 59.9;
        const centerLon = mapCenter?.longitude ?? 10.7;

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
            if (this.zoom?.auto_level) {
                this._fitMapToVisibleMarkers();
            } else {
                const vc = this._getVisibleCenter();
                if (vc) {
                    this._leafletMap.setView([vc.lat, vc.lon], zoomLevel, { animate: false });
                }
            }
        } else if (this.zoom?.auto_level) {
            const layers = this._getVisibleLayers();
            if (layers.length > 0) {
                const group = window.L.featureGroup(layers);
                this._leafletMap.fitBounds(group.getBounds().pad(0.1), { animate: false, maxZoom: 18 });
            }
        }

        this._setupResizeObserver(mapContainer);
        this._mapInitialized = true;
        this._lastCenterPos = null;
    }

    private _fitMapToVisibleMarkers() {
        if (!this._leafletMap) return;
        const layers = this._getVisibleLayers();
        if (layers.length === 0) return;

        const group = window.L.featureGroup(layers);
        if (this._isZoomOutOnly) {
            const fitZoom = this._leafletMap.getBoundsZoom(group.getBounds().pad(0.1));
            if (fitZoom < this._leafletMap.getZoom()) {
                this._leafletMap.fitBounds(group.getBounds().pad(0.1), { animate: false, maxZoom: 18 });
            }
        } else {
            this._leafletMap.fitBounds(group.getBounds().pad(0.1), { animate: false, maxZoom: 18 });
        }
    }

    private _getVisibleLayers(): any[] {
        const markers = Array.from(this._markers.entries())
            .filter(([eid]) => !this._hiddenPersons.has(eid))
            .map(([_, m]) => m);
        const trailCircles: any[] = [];
        for (const person of this.persons) {
            if (this._hiddenPersons.has(person.entity_id)) continue;
            const isMarked = this._markers.has(person.entity_id);
            if (!isMarked) {
                const tl = this._trailLayers.get(person.entity_id);
                if (tl) trailCircles.push(...tl.circles);
            }
        }
        return [...markers, ...trailCircles];
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
            const auth = (this._hass as any).auth;
            const token = auth?.access_token || auth?.data?.access_token || '';
            const resp = await fetch(url, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result: any[][] = await resp.json();

            console.log('[LensMap] history response entities:', result.length, 'trackers queried:', allDeviceTrackers);
            for (const states of result) {
                if (states.length === 0) continue;
                const eid = states[0].entity_id;
                const withLat = states.filter((s: any) => typeof s.attributes?.latitude === 'number').length;
                const withLon = states.filter((s: any) => typeof s.attributes?.longitude === 'number').length;
                console.log('[LensMap] history for', eid, '- records:', states.length, 'withLat:', withLat, 'withLon:', withLon);
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
                    if (!last || haversine(last.lat, last.lon, p.lat, p.lon) > 0.05) {
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
        const now = Date.now();

        if (!enabled) {
            this._clearTrails();
            return;
        }

        for (const person of this.persons) {
            if (this._hiddenPersons.has(person.entity_id)) continue;
            const location = getLocation(this._hass, person.entity_id);
            if (!location) continue;

            let history = this._positionHistory.get(person.entity_id) || [];

            const last = history[history.length - 1];
            const isDuplicate = last && haversine(last.lat, last.lon, location.latitude, location.longitude) <= 0.05;

            if (!isDuplicate) {
                history.push({ lat: location.latitude, lon: location.longitude, ts: now });
            }

            history = history.filter(p => (now - p.ts) <= maxAgeMs);
            this._positionHistory.set(person.entity_id, history);
        }

        this._drawTrails();
    }

    private _clearTrails() {
        for (const { polylines, circles } of this._trailLayers.values()) {
            polylines.forEach(p => p.remove());
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
        const userLoc = this._getCurrentUserLocation();
        const trailConditions = this.trail?.conditions;

        for (const [idx, person] of this.persons.entries()) {
            if (this._hiddenPersons.has(person.entity_id)) continue;
            const history = this._positionHistory.get(person.entity_id);
            if (!history || history.length < 2) continue;

            const personLoc = getLocation(this._hass, person.entity_id);

            let historyToFilter = history;

            if (this.trail?.gps_jump_filter) {
                const original = historyToFilter;
                if (original.length >= 3) {
                    historyToFilter = [original[0]];
                    for (let i = 1; i < original.length - 1; i++) {
                        const prev = historyToFilter[historyToFilter.length - 1];
                        const curr = original[i];
                        const next = original[i + 1];
                        const distPrevNext = haversine(prev.lat, prev.lon, next.lat, next.lon);
                        const distPrevCurr = haversine(prev.lat, prev.lon, curr.lat, curr.lon);
                        if (distPrevCurr <= distPrevNext) {
                            historyToFilter.push(curr);
                        }
                    }
                    historyToFilter.push(original[original.length - 1]);
                }
            }

            if (historyToFilter.length < 2) continue;

            const personTrailConditions = this.trail?.person_conditions?.[person.entity_id] ?? trailConditions;
            const defaultTrailConditions = personTrailConditions !== trailConditions ? trailConditions : undefined;

            const kept = new Array(historyToFilter.length).fill(true);

            if (personTrailConditions && personTrailConditions.length > 0) {
                for (let i = 0; i < historyToFilter.length; i++) {
                    const ctx: TrailPointContext = {
                        point: historyToFilter[i],
                        personLocation: personLoc,
                        userLocation: userLoc,
                        hass: this._hass,
                        person,
                    };
                    kept[i] = evaluateTrailPointConditions(ctx, personTrailConditions, defaultTrailConditions);
                }
            }

            const filteredHistory = historyToFilter.filter((_, i) => kept[i]);
            if (filteredHistory.length < 2) continue;

            const color = this._getTrailColor(person, idx);

            const polylines: any[] = [];
            let segStart: number | null = null;
            for (let i = 0; i < historyToFilter.length; i++) {
                if (kept[i]) {
                    if (segStart === null) segStart = i;
                } else {
                    if (segStart !== null && i - segStart >= 2) {
                        const seg = historyToFilter.slice(segStart, i).map(p => [p.lat, p.lon] as [number, number]);
                        polylines.push(window.L.polyline(seg, { color, weight: 3, opacity: 0.7 }).addTo(this._leafletMap));
                    }
                    segStart = null;
                }
            }
            if (segStart !== null && historyToFilter.length - segStart >= 2) {
                const seg = historyToFilter.slice(segStart).map(p => [p.lat, p.lon] as [number, number]);
                polylines.push(window.L.polyline(seg, { color, weight: 3, opacity: 0.7 }).addTo(this._leafletMap));
            }

            const circles = filteredHistory.map(p => {
                const age = now - p.ts;
                const t = Math.max(0, Math.min(1, age / maxAgeMs));
                const newestOpacity = this.trail?.newest_opacity ?? 1;
                const oldestOpacity = this.trail?.oldest_opacity ?? 0.3;
                const mid = this.trail?.midpoint ?? 50;
                const exponent = Math.pow(5, (mid - 50) / 50);
                const adjustedT = Math.pow(t, exponent);
                const opacity = newestOpacity - (newestOpacity - oldestOpacity) * adjustedT;
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

            const isVisible = this._evaluatePersonDisplayRules(person);
            if (isVisible && personLoc && filteredHistory.length > 0) {
                const last = filteredHistory[filteredHistory.length - 1];
                polylines.push(window.L.polyline(
                    [[personLoc.latitude, personLoc.longitude], [last.lat, last.lon]],
                    { color, weight: 2, opacity: 0.7, dashArray: '6, 6' }
                ).addTo(this._leafletMap));
            }

            this._trailLayers.set(person.entity_id, { polylines, circles });
        }
    }

    private _setupResizeObserver(container: HTMLElement) {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        let pending = false;
        this._resizeObserver = new ResizeObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                try {
                    if (this._leafletMap) {
                        this._leafletMap.invalidateSize({ pan: false });
                    }
                } catch (e) {
                    console.error('[LensMap] invalidateSize error:', e);
                }
            });
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

    private _recenterMap() {
        if (!this._leafletMap || !this._mapInitialized) return;
        const centerType = this.center?.type || 'user';

        if (centerType === 'fixed') return;

        if (centerType === 'visible' && this._effectiveAutoZoom) {
            this._fitMapToVisibleMarkers();
            return;
        }

        let target: { lat: number; lon: number } | null = null;

        if (centerType === 'visible') {
            target = this._getVisibleCenter();
        } else {
            const loc = this._getMapCenter();
            if (loc) target = { lat: loc.latitude, lon: loc.longitude };
        }

        if (!target) return;

        if (this._lastCenterPos) {
            const d = haversine(this._lastCenterPos.lat, this._lastCenterPos.lng, target.lat, target.lon);
            if (d <= 0.1) return;
        }

        this._lastCenterPos = { lat: target.lat, lng: target.lon };
        const zoom = this._effectiveAutoZoom
            ? (this._isZoomOutOnly
                ? Math.min(this._getFitZoom(), this._leafletMap.getZoom())
                : this._getFitZoom())
            : this._leafletMap.getZoom();
        this._leafletMap.setView([target.lat, target.lon], zoom, { animate: true });
    }

    private _getFitZoom(): number {
        const layers = this._getVisibleLayers();
        if (layers.length === 0) return this._leafletMap.getZoom();
        const group = window.L.featureGroup(layers);
        const bounds = group.getBounds();
        return this._leafletMap.getBoundsZoom(bounds);
    }

    private _getVisibleCenter(): { lat: number; lon: number } | null {
        const layers = this._getVisibleLayers();
        if (layers.length === 0) return null;
        const latlngs = layers.map((m: any) => m.getLatLng());
        const avgLat = latlngs.reduce((s: number, ll: any) => s + ll.lat, 0) / latlngs.length;
        const avgLon = latlngs.reduce((s: number, ll: any) => s + ll.lng, 0) / latlngs.length;
        return { lat: avgLat, lon: avgLon };
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
            if (this._hiddenPersons.has(person.entity_id)) continue;
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

            marker.setZIndexOffset(person.entity_id === this.current_user ? -1000 : 0);

            marker.bindPopup(`<strong>${name}</strong><br>${entityState}`);
            this._markers.set(person.entity_id, marker);
        }

        for (const [entityId, marker] of this._markers) {
            if (visible.has(entityId) && entityId === this.current_user) {
                marker.setZIndexOffset(-1000);
            }
        }

        if (this.center?.type === 'visible' && !this._mapInitialized) {
            this._fitMapToVisibleMarkers();
        }
    }

    private _evaluatePersonDisplayRules(person: PersonConfig): boolean {
        const conditions = person.displayConditions?.length
            ? person.displayConditions
            : this.displayConditions || [];
        if (conditions.length === 0) return true;
        const defaultConditions = person.displayConditions?.length ? (this.displayConditions || []) : undefined;
        return evaluateConditions(this._hass, person, this._getCurrentUserLocation(), conditions, defaultConditions);
    }

    private _togglePerson(entityId: string) {
        if (this._hiddenPersons.has(entityId)) {
            this._hiddenPersons.delete(entityId);
        } else {
            this._hiddenPersons.add(entityId);
        }
        this._hiddenPersons = new Set(this._hiddenPersons);
        if (this._leafletMap) {
            this._updateMarkers();
            this._drawTrails();
            if (this._effectiveAutoZoom) {
                if (this.center?.type === 'visible') {
                    this._fitMapToVisibleMarkers();
                } else {
                    const loc = this._getMapCenter();
                    if (loc) this._leafletMap.setView([loc.latitude, loc.longitude], this._getFitZoom(), { animate: true });
                }
            }
        }
    }

    private _toggleAutoZoom() {
        const cycle: Record<string, 'off' | 'fit' | 'zoom_out'> = { off: 'fit', fit: 'zoom_out', zoom_out: 'off' };
        this._autoZoomMode = cycle[this._autoZoomMode] || 'off';
        if (this._effectiveAutoZoom && this._leafletMap) {
            if (this.center?.type === 'visible') {
                this._fitMapToVisibleMarkers();
            } else {
                const loc = this._getMapCenter();
                if (loc) this._leafletMap.setView([loc.latitude, loc.longitude], this._getFitZoom(), { animate: true });
            }
        }
    }

    private _getPersonIconUrl(person: PersonConfig): string | null {
        const stateObj = this._hass?.states?.[person.entity_id];
        const picture = stateObj?.attributes?.entity_picture;
        if (picture) return picture;
        return null;
    }

    render() {
        return html`
            <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css">
            <ha-card>
                ${this.show_title ? html`<div class="card-header">${this.title}</div>` : ''}
                <div class="map-wrapper">
                    <div id="map-container" class="map-container"></div>
                    <div class="map-overlay">
                        ${this.show_auto_zoom ? html`
                            <button class="overlay-btn ${this._effectiveAutoZoom ? 'active' : ''}"
                                    @click=${this._toggleAutoZoom}
                                    title="${this._autoZoomMode === 'off' ? 'Auto zoom: Off (click to enable fit)' : this._autoZoomMode === 'fit' ? 'Auto zoom: Fit all (click to enable zoom out only)' : 'Auto zoom: Zoom out only (click to disable)'}">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="3"/>
                                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${this.show_toggle_buttons ? this.persons.map(person => {
                            const isHidden = this._hiddenPersons.has(person.entity_id);
                            const name = person.name || this._hass?.states?.[person.entity_id]?.attributes?.friendly_name || person.entity_id;
                            const imgUrl = this._getPersonIconUrl(person);
                            return html`
                                <button class="overlay-person-btn ${isHidden ? 'hidden' : ''}"
                                        @click=${() => this._togglePerson(person.entity_id)}
                                        title="${name} (${isHidden ? 'hidden' : 'visible'})">
                                    ${imgUrl ? html`
                                        <img src="${imgUrl}" class="person-icon-img" />
                                    ` : html`
                                        <span class="person-icon-letter">${name.charAt(0).toUpperCase()}</span>
                                    `}
                                </button>
                            `;
                        }) : ''}
                    </div>
                </div>
            </ha-card>
        `;
    }

    static styles = css`
        :host {
            display: block;
            height: 100%;
        }
        ha-card {
            display: flex;
            flex-direction: column;
            height: 100%;
            padding: 16px;
        }
        .card-header {
            font-weight: bold;
            font-size: 1.2em;
            margin-bottom: 10px;
        }
        .map-wrapper {
            position: relative;
            flex: 1;
            min-height: 0;
        }
        .map-container {
            height: 100%;
            width: 100%;
            border-radius: 8px;
            overflow: hidden;
        }
        .map-overlay {
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            z-index: 1000;
        }
        .overlay-btn {
            width: 32px;
            height: 32px;
            border-radius: 4px;
            border: 2px solid rgba(0,0,0,0.2);
            background: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 1px 5px rgba(0,0,0,0.65);
            color: #333;
            padding: 0;
        }
        .overlay-btn.active {
            background: #03a9f4;
            color: white;
            border-color: #039be5;
        }
        .overlay-person-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid rgba(0,0,0,0.2);
            background: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 1px 5px rgba(0,0,0,0.65);
            overflow: hidden;
            padding: 0;
            transition: filter 0.2s, opacity 0.2s;
        }
        .overlay-person-btn.hidden {
            filter: grayscale(1);
            opacity: 0.5;
        }
        .person-icon-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .person-icon-letter {
            font-size: 12px;
            font-weight: bold;
            color: #333;
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