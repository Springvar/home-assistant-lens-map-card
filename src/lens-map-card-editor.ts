import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import { LensMapCardConfig, PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig } from './lens-map-card';
import { TRAIL_COLORS, migrateDisplayRules } from './types';
import type { PersonSensors, TrailConfig, DisplayCondition, SensorCondition, GroupCondition, NotCondition, ConditionComparator } from './types';
import { BUILT_IN_SENSORS } from './types';

const VALID_MAPS = ['none', 'system', 'bw', 'light', 'color', 'dark', 'voyager', 'satellite', 'topo', 'outlines'];
const VALID_ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const WHEN_OPTIONS = ['night', 'morning', 'afternoon', 'evening', 'weekday', 'weekend'];

const NUMERIC_COMPARATORS: { value: ConditionComparator; label: string }[] = [
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
];

const TEXT_COMPARATORS: { value: ConditionComparator; label: string }[] = [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'oneOf', label: 'one of' },
    { value: 'notOneOf', label: 'not one of' },
];

function isSensorCondition(c: DisplayCondition): c is SensorCondition {
    return 'sensor' in c && !('type' in c);
}

function isGroupCondition(c: DisplayCondition): c is GroupCondition {
    return 'type' in c && 'conditions' in c;
}

function isNotCondition(c: DisplayCondition): c is NotCondition {
    return 'type' in c && 'condition' in c;
}

type ConditionContext = 'default' | `person:${number}`;

export class LensMapCardEditor extends LitElement {
    @property({ attribute: false }) public hass: any;
    @state() private _config: LensMapCardConfig = { persons: [] };

    get availablePersons(): string[] {
        if (!this.hass) return [];
        return Object.keys(this.hass.states)
            .filter(eid => eid.startsWith('person.'))
            .filter(eid => !this._config.persons?.some(p => p.entity_id === eid));
    }

    get uniqueNamedSensors(): string[] {
        const sensorNames = new Set<string>();
        for (const person of this._config.persons || []) {
            if (person.namedSensors) {
                Object.keys(person.namedSensors).forEach(name => sensorNames.add(name));
            }
        }
        return Array.from(sensorNames).sort();
    }

    get allZoneEntities(): string[] {
        if (!this.hass) return [];
        return Object.keys(this.hass.states)
            .filter(eid => eid.startsWith('zone.'))
            .sort();
    }

    setConfig(config: LensMapCardConfig) {
        const safeConfig = config || { persons: [] };
        this._config = {
            ...safeConfig,
            displayConditions: safeConfig.displayConditions ||
                (safeConfig.display_rules ? migrateDisplayRules(safeConfig.display_rules) : [{ sensor: 'distance', comparator: 'lt', value: '1000' }]),
            map: safeConfig.map || { type: 'color', opacity: 1 },
            zoom: safeConfig.zoom || { level: 10, auto_level: false },
            center: safeConfig.center || { type: 'user' },
            trail: safeConfig.trail || { enabled: false, max_age: 60 },
            show_auto_zoom: safeConfig.show_auto_zoom ?? true,
            show_toggle_buttons: safeConfig.show_toggle_buttons ?? true
        };

        for (const person of this._config.persons || []) {
            if (!person.displayConditions && person.displayRules) {
                person.displayConditions = migrateDisplayRules(person.displayRules);
            }
        }

        this.requestUpdate();
    }

    private _getConditions(context: ConditionContext): DisplayCondition[] {
        if (context === 'default') {
            return this._config.displayConditions || [];
        }
        const idx = parseInt(context.split(':')[1]);
        return this._config.persons?.[idx]?.displayConditions || [];
    }

    private _setConditions(context: ConditionContext, conditions: DisplayCondition[]) {
        if (context === 'default') {
            this._config = { ...this._config, displayConditions: conditions };
        } else {
            const idx = parseInt(context.split(':')[1]);
            const persons = [...(this._config.persons || [])];
            persons[idx] = { ...persons[idx], displayConditions: conditions };
            this._config = { ...this._config, persons };
        }
    }

    private _getConditionAtPath(path: string): { parent: DisplayCondition[]; index: number; condition: DisplayCondition } | null {
        const parts = path.split(':');
        const context = parts[0] as ConditionContext;
        const indices = parts.slice(1).map(Number);

        let current: DisplayCondition[] = this._getConditions(context);
        for (let i = 0; i < indices.length - 1; i++) {
            const c = current[indices[i]];
            if (isGroupCondition(c)) {
                current = c.conditions;
            } else if (isNotCondition(c)) {
                if (i === indices.length - 2) {
                    return { parent: current, index: indices[i], condition: c };
                }
                current = [c.condition];
            } else {
                return null;
            }
        }
        return { parent: current, index: indices[indices.length - 1], condition: current[indices[indices.length - 1]] };
    }

    private _updateConditionAtPath(path: string, updater: (c: DisplayCondition) => void) {
        const parts = path.split(':');
        const context = parts[0] as ConditionContext;
        const indices = parts.slice(1).map(Number);

        const conditions = JSON.parse(JSON.stringify(this._getConditions(context))) as DisplayCondition[];
        let current = conditions;
        for (let i = 0; i < indices.length - 1; i++) {
            const c = current[indices[i]];
            if (isGroupCondition(c)) {
                current = c.conditions;
            } else if (isNotCondition(c)) {
                current = [c.condition];
            } else {
                return;
            }
        }
        updater(current[indices[indices.length - 1]]);
        this._setConditions(context, conditions);
        this._emitConfigChanged();
    }

    private _addConditionToPath(parentPath: string, newCondition: DisplayCondition) {
        const parts = parentPath.split(':');
        const context = parts[0] as ConditionContext;

        const conditions = JSON.parse(JSON.stringify(this._getConditions(context))) as DisplayCondition[];
        let current: DisplayCondition[] = conditions;
        for (let i = 1; i < parts.length; i++) {
            const c = current[parseInt(parts[i])];
            if (isGroupCondition(c)) {
                current = c.conditions;
            } else if (isNotCondition(c)) {
                current = [c.condition];
            } else {
                return;
            }
        }
        current.push(newCondition);
        this._setConditions(context, conditions);
        this._emitConfigChanged();
    }

    private _removeConditionAtPath(path: string) {
        const parts = path.split(':');
        const context = parts[0] as ConditionContext;
        const indices = parts.slice(1).map(Number);

        const conditions = JSON.parse(JSON.stringify(this._getConditions(context))) as DisplayCondition[];
        let current = conditions;
        for (let i = 0; i < indices.length - 1; i++) {
            const c = current[indices[i]];
            if (isGroupCondition(c)) {
                current = c.conditions;
            } else if (isNotCondition(c)) {
                current = [c.condition];
            } else {
                return;
            }
        }
        current.splice(indices[indices.length - 1], 1);
        this._setConditions(context, conditions);
        this._emitConfigChanged();
    }

    private _getConditionSummary(condition: DisplayCondition): string {
        if (isSensorCondition(condition)) {
            const op = TEXT_COMPARATORS.find(c => c.value === condition.comparator)?.label || condition.comparator;
            const val = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '');
            return `${condition.sensor} ${op} ${val}`;
        }
        if (isGroupCondition(condition)) {
            const count = condition.conditions.length;
            return `${condition.type} (${count} condition${count !== 1 ? 's' : ''})`;
        }
        if (isNotCondition(condition)) {
            return `NOT ${this._getConditionSummary(condition.condition)}`;
        }
        return 'Unknown';
    }

    private _getSensorOptions(context: ConditionContext): { group: string; value: string; label: string }[] {
        const options: { group: string; value: string; label: string }[] = [
            { group: 'Built-in', value: 'distance', label: 'Distance (m)' },
            { group: 'Built-in', value: 'state', label: 'Person state' },
            { group: 'Selector', value: 'who', label: 'Who (person)' },
            { group: 'Selector', value: 'where', label: 'Where (zone)' },
            { group: 'Selector', value: 'when', label: 'When (time)' },
            { group: 'Selector', value: 'user', label: 'User (logged in)' },
            { group: 'Selector', value: 'random', label: 'Random (%)' },
        ];

        if (context !== 'default') {
            const personIdx = parseInt(context.split(':')[1]);
            const person = this._config.persons?.[personIdx];
            if (person?.namedSensors) {
                for (const name of Object.keys(person.namedSensors).sort()) {
                    options.push({ group: 'Named sensor', value: name, label: name });
                }
            }
        }

        return options;
    }

    private _getComparatorOptions(sensor: string): { value: ConditionComparator; label: string }[] {
        if (sensor === 'distance' || sensor === 'random') return NUMERIC_COMPARATORS;
        if (sensor === 'state') return [...NUMERIC_COMPARATORS, ...TEXT_COMPARATORS];
        return TEXT_COMPARATORS;
    }

    private _getWhoOptions(): string[] {
        if (!this.hass) return [];
        return Object.keys(this.hass.states)
            .filter(eid => eid.startsWith('person.'))
            .sort();
    }

    private _getWhereOptions(): string[] {
        if (!this.hass) return [];
        const zones = Object.keys(this.hass.states)
            .filter(eid => eid.startsWith('zone.'))
            .sort();
        return zones;
    }

    private _renderConditionValueInput(condition: SensorCondition, path: string) {
        const { sensor } = condition;

        if (sensor === 'when') {
            const selectedValues = Array.isArray(condition.value)
                ? condition.value
                : typeof condition.value === 'string'
                    ? condition.value.split(',').map(v => v.trim())
                    : [];
            return html`
                <div class="multi-select">
                    ${WHEN_OPTIONS.map(opt => html`
                        <label class="chip ${selectedValues.includes(opt) ? 'selected' : ''}">
                            <input type="checkbox"
                                ?checked=${selectedValues.includes(opt)}
                                @change=${(e: Event) => {
                                    const checked = (e.target as HTMLInputElement).checked;
                                    const newVal = checked
                                        ? [...selectedValues, opt]
                                        : selectedValues.filter(v => v !== opt);
                                    this._updateConditionAtPath(path, (c) => {
                                        (c as SensorCondition).value = newVal.length === 1 ? newVal[0] : newVal;
                                    });
                                }} />
                            ${opt}
                        </label>
                    `)}
                </div>`;
        }

        if (sensor === 'who') {
            return html`
                <select .value=${String(condition.value ?? '')}
                    @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                        (c as SensorCondition).value = (e.target as HTMLSelectElement).value;
                    })}>
                    <option value="">Select person...</option>
                    ${this._getWhoOptions().map(eid => html`
                        <option value="${eid}" ?selected=${condition.value === eid}>
                            ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                        </option>
                    `)}
                </select>`;
        }

        if (sensor === 'where') {
            return html`
                <select .value=${String(condition.value ?? '')}
                    @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                        (c as SensorCondition).value = (e.target as HTMLSelectElement).value;
                    })}>
                    <option value="">Select zone...</option>
                    ${this._getWhereOptions().map(eid => html`
                        <option value="${eid}" ?selected=${condition.value === eid}>
                            ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                        </option>
                    `)}
                </select>`;
        }

        if (sensor === 'user') {
            return html`
                <select .value=${String(condition.value ?? '')}
                    @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                        (c as SensorCondition).value = (e.target as HTMLSelectElement).value;
                    })}>
                    <option value="">Select...</option>
                    <option value="user" ?selected=${condition.value === 'user'}>Current user</option>
                    ${this._getWhoOptions().map(eid => html`
                        <option value="${eid}" ?selected=${condition.value === eid}>
                            ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                        </option>
                    `)}
                </select>`;
        }

        if (sensor === 'random') {
            return html`
                <input type="number" min="0" max="100" step="1"
                    .value=${String(condition.value ?? '')}
                    @input=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                        (c as SensorCondition).value = (e.target as HTMLInputElement).value;
                    })}
                    placeholder="0-100" style="width: 80px;" />`;
        }

        if (['oneOf', 'notOneOf'].includes(condition.comparator)) {
            const values = Array.isArray(condition.value)
                ? condition.value
                : typeof condition.value === 'string'
                    ? condition.value.split(',').map(v => v.trim()).filter(v => v)
                    : [String(condition.value ?? '')];
            return html`
                <div class="value-chips">
                    ${values.map((v, i) => html`
                        <span class="chip selected">${v}
                            <button class="chip-remove" @click=${() => {
                                const newVals = values.filter((_, idx) => idx !== i);
                                this._updateConditionAtPath(path, (c) => {
                                    (c as SensorCondition).value = newVals;
                                });
                            }}>&times;</button>
                        </span>
                    `)}
                    <input type="text" placeholder="Add value..." style="width: 100px;"
                        @keydown=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                                const input = e.target as HTMLInputElement;
                                const val = input.value.trim();
                                if (val) {
                                    this._updateConditionAtPath(path, (c) => {
                                        const existing = Array.isArray((c as SensorCondition).value)
                                            ? (c as SensorCondition).value as string[]
                                            : [String((c as SensorCondition).value ?? '')];
                                        (c as SensorCondition).value = [...existing, val];
                                    });
                                    input.value = '';
                                }
                            }
                        }} />
                </div>`;
        }

        return html`
            <input type="text" .value=${String(condition.value ?? '')}
                @input=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                    (c as SensorCondition).value = (e.target as HTMLInputElement).value;
                })}
                placeholder="value" style="width: 100px;" />`;
    }

    private _renderSensorCondition(condition: SensorCondition, path: string, context: ConditionContext) {
        const sensorOptions = this._getSensorOptions(context);
        const groups = [...new Set(sensorOptions.map(o => o.group))];
        const comparatorOptions = this._getComparatorOptions(condition.sensor);

        return html`
            <details class="condition-box condition-sensor" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-sensor">Value</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="condition-row">
                        <label>Sensor:</label>
                        <select .value=${condition.sensor}
                            @change=${(e: Event) => {
                                const newSensor = (e.target as HTMLSelectElement).value;
                                this._updateConditionAtPath(path, (c) => {
                                    const sc = c as SensorCondition;
                                    sc.sensor = newSensor;
                                    const newComparators = this._getComparatorOptions(newSensor);
                                    if (!newComparators.find(o => o.value === sc.comparator)) {
                                        sc.comparator = newComparators[0].value;
                                    }
                                });
                            }}>
                            ${groups.map(g => html`
                                <optgroup label="${g}">
                                    ${sensorOptions.filter(o => o.group === g).map(o => html`
                                        <option value="${o.value}" ?selected=${condition.sensor === o.value}>${o.label}</option>
                                    `)}
                                </optgroup>
                            `)}
                        </select>
                    </div>
                    <div class="condition-row">
                        <label>Comparator:</label>
                        <select .value=${condition.comparator}
                            @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                                (c as SensorCondition).comparator = (e.target as HTMLSelectElement).value as ConditionComparator;
                            })}>
                            ${comparatorOptions.map(o => html`
                                <option value="${o.value}" ?selected=${condition.comparator === o.value}>${o.label}</option>
                            `)}
                        </select>
                    </div>
                    <div class="condition-row">
                        <label>Value:</label>
                        ${this._renderConditionValueInput(condition, path)}
                    </div>
                </div>
            </details>`;
    }

    private _renderGroupCondition(condition: GroupCondition, path: string, context: ConditionContext, isNested: boolean = false) {
        return html`
            <details class="condition-box condition-group ${isNested ? 'nested' : ''}" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-group">${condition.type}</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="condition-row">
                        <label>Logic:</label>
                        <select .value=${condition.type}
                            @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                                (c as GroupCondition).type = (e.target as HTMLSelectElement).value as 'AND' | 'OR';
                            })}>
                            <option value="AND" ?selected=${condition.type === 'AND'}>AND (all must match)</option>
                            <option value="OR" ?selected=${condition.type === 'OR'}>OR (any can match)</option>
                        </select>
                    </div>
                    <div class="nested-conditions">
                        ${condition.conditions.map((child, i) => this._renderCondition(child, `${path}:${i}`, context, true))}
                    </div>
                    <div class="add-condition-buttons">
                        <button class="btn-small" @click=${() => this._addConditionToPath(path, { sensor: 'distance', comparator: 'lt', value: '1000' })}>+ Value</button>
                        <button class="btn-small" @click=${() => this._addConditionToPath(path, { type: 'AND', conditions: [] })}>+ Group</button>
                        <button class="btn-small" @click=${() => this._addConditionToPath(path, { type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } })}>+ NOT</button>
                    </div>
                </div>
            </details>`;
    }

    private _renderNotCondition(condition: NotCondition, path: string, context: ConditionContext, isNested: boolean = false) {
        return html`
            <details class="condition-box condition-not ${isNested ? 'nested' : ''}" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-not">NOT</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="nested-conditions">
                        ${this._renderCondition(condition.condition, `${path}:0`, context, true)}
                    </div>
                </div>
            </details>`;
    }

    private _renderCondition(condition: DisplayCondition, path: string, context: ConditionContext, isNested: boolean = false) {
        if (isSensorCondition(condition)) {
            return this._renderSensorCondition(condition, path, context);
        }
        if (isGroupCondition(condition)) {
            return this._renderGroupCondition(condition, path, context, isNested);
        }
        if (isNotCondition(condition)) {
            return this._renderNotCondition(condition, path, context, isNested);
        }
        return html``;
    }

    private _addPerson(e: Event) {
        const select = e.target as HTMLSelectElement;
        const entityId = select.value;
        if (!entityId) return;

        const newPerson: PersonConfig = {
            entity_id: entityId,
        };

        this._config = {
            ...this._config,
            persons: [...(this._config.persons || []), newPerson]
        };
        select.value = '';
        this._emitConfigChanged();
    }

    private _removePerson(idx: number) {
        const persons = [...(this._config.persons || [])];
        persons.splice(idx, 1);
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _personNameChanged(idx: number, e: Event) {
        const value = (e.target as HTMLInputElement).value;
        const persons = [...(this._config.persons || [])];
        persons[idx] = { ...persons[idx], name: value };
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _updateNamedSensorName(personIdx: number, oldName: string, newName: string) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (!person.namedSensors || !person.namedSensors[oldName]) return;

        const sensor = person.namedSensors[oldName];
        delete person.namedSensors[oldName];
        if (newName) {
            person.namedSensors[newName] = sensor;
        }
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _updateNamedSensorEntity(personIdx: number, name: string, value: string) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (!person.namedSensors) {
            person.namedSensors = {};
        }
        const entityIds = value.split(',').map(v => v.trim()).filter(v => v);
        person.namedSensors[name] = { entity_id: entityIds.length === 1 ? entityIds[0] : entityIds };
        this._config = { ...this._config, persons };
        this.requestUpdate();
        this._emitConfigChanged();
    }

    private _updateNamedSensorAttribute(personIdx: number, name: string, value: string) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (!person.namedSensors?.[name]) return;
        person.namedSensors[name].attribute = value || undefined;
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _addNamedSensorFromText(personIdx: number) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (!person.namedSensors) {
            person.namedSensors = {};
        }
        const input = this.shadowRoot?.querySelector(`#new-sensor-name-${personIdx}`) as HTMLInputElement;
        const name = input?.value.trim();
        if (name && !person.namedSensors[name]) {
            person.namedSensors[name] = { entity_id: '' };
            this._config = { ...this._config, persons };
            if (input) input.value = '';
            this.requestUpdate();
            this._emitConfigChanged();
        }
    }

    private _removeNamedSensor(personIdx: number, name: string) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (person.namedSensors) {
            delete person.namedSensors[name];
        }
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _mapTypeChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value as MapConfig['type'];
        this._config = { ...this._config, map: { ...this._config.map, type: value } };
        this._emitConfigChanged();
    }

    private _mapOpacityChanged(e: Event) {
        const value = parseFloat((e.target as HTMLInputElement).value);
        this._config = { ...this._config, map: { ...this._config.map, opacity: value } };
        this._emitConfigChanged();
    }

    private _mapApiKeyChanged(e: Event) {
        const value = (e.target as HTMLInputElement).value;
        this._config = { ...this._config, map: { ...this._config.map, api_key: value } };
        this._emitConfigChanged();
    }

    private _mapInteractiveChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, map: { ...this._config.map, interactive: checked } };
        this._emitConfigChanged();
    }

    private _zoomLevelChanged(e: Event) {
        const value = parseInt((e.target as HTMLSelectElement).value);
        this._config = { ...this._config, zoom: { ...this._config.zoom, level: value } };
        this._emitConfigChanged();
    }

    private _zoomAutoChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, zoom: { ...this._config.zoom, auto_level: checked } };
        this._emitConfigChanged();
    }

    private _centerTypeChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value as 'user' | 'visible' | 'home' | 'fixed' | 'person';
        this._config = { ...this._config, center: { ...this._config.center, type: value } };
        this._emitConfigChanged();
    }

    private _centerHomeZoneChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        this._config = { ...this._config, center: { ...this._config.center, home_zone: value } };
        this._emitConfigChanged();
    }

    private _centerFixedCoordinatesChanged(coordinate: 'lat' | 'lon', value: string) {
        const fixed = { ...this._config.center?.fixed_coordinates };
        if (coordinate === 'lat') {
            fixed.lat = parseFloat(value) || 0;
        } else {
            fixed.lon = parseFloat(value) || 0;
        }
        this._config = { ...this._config, center: { ...this._config.center, fixed_coordinates: fixed } };
        this._emitConfigChanged();
    }

    private _selectLocationOnMap() {
        this.dispatchEvent(new CustomEvent('select-location', {
            bubbles: true,
            composed: true
        }));
    }

    private get homeZones(): string[] {
        if (!this.hass) return [];
        return Object.keys(this.hass.states)
            .filter(eid => eid.startsWith('zone.'));
    }

    private _titleChanged(e: Event) {
        const value = (e.target as HTMLInputElement).value;
        this._config = { ...this._config, title: value };
        this._emitConfigChanged();
    }

    private _showTitleChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, show_title: checked };
        this._emitConfigChanged();
    }

    private _showAutoZoomChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, show_auto_zoom: checked };
        this._emitConfigChanged();
    }

    private _showToggleButtonsChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, show_toggle_buttons: checked };
        this._emitConfigChanged();
    }

    private _trailEnabledChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, trail: { ...this._config.trail, enabled: checked } };
        this._emitConfigChanged();
    }

    private _trailMaxAgeChanged(e: Event) {
        const value = parseInt((e.target as HTMLInputElement).value) || 60;
        this._config = { ...this._config, trail: { ...this._config.trail, max_age: value } };
        this._emitConfigChanged();
    }

    private _trailMaxDistanceChanged(e: Event) {
        const value = (e.target as HTMLInputElement).value;
        this._config = { ...this._config, trail: { ...this._config.trail, max_distance: value ? parseFloat(value) : undefined } };
        this._emitConfigChanged();
    }

    private _trailProximityChanged(e: Event) {
        const value = parseInt((e.target as HTMLInputElement).value) || 0;
        this._config = { ...this._config, trail: { ...this._config.trail, proximity: value } };
        this._emitConfigChanged();
    }

    private _trailNewestOpacityChanged(e: Event) {
        const value = parseFloat((e.target as HTMLInputElement).value);
        this._config = { ...this._config, trail: { ...this._config.trail, newest_opacity: value } };
        this._emitConfigChanged();
    }

    private _trailOldestOpacityChanged(e: Event) {
        const value = parseFloat((e.target as HTMLInputElement).value);
        this._config = { ...this._config, trail: { ...this._config.trail, oldest_opacity: value } };
        this._emitConfigChanged();
    }

    private _trailMidpointChanged(e: Event) {
        const value = parseInt((e.target as HTMLInputElement).value);
        this._config = { ...this._config, trail: { ...this._config.trail, midpoint: value } };
        this._emitConfigChanged();
    }

    private _trailColorChanged(entityId: string, e: Event) {
        const value = (e.target as HTMLInputElement).value;
        const colors = { ...(this._config.trail?.colors || {}) };
        if (value) {
            colors[entityId] = value;
        } else {
            delete colors[entityId];
        }
        this._config = { ...this._config, trail: { ...this._config.trail, colors } };
        this._emitConfigChanged();
    }

    private _trailColorReset(entityId: string) {
        const colors = { ...(this._config.trail?.colors || {}) };
        delete colors[entityId];
        this._config = { ...this._config, trail: { ...this._config.trail, colors } };
        this._emitConfigChanged();
    }

    private _emitConfigChanged() {
        this.dispatchEvent(new CustomEvent('config-changed', {
            detail: { config: this._config },
            bubbles: true,
            composed: true
        }));
    }

    private _getSensorState(entityId: string | string[]): string {
        if (!this.hass) return 'unavailable';
        if (Array.isArray(entityId)) {
            return entityId.map(id => this.hass.states[id]?.state || 'unknown').join(' | ');
        }
        return this.hass.states[entityId]?.state || 'unavailable';
    }

    render() {
        if (!this.hass) return html``;

        return html`
            <div class="editor-container">
                <div class="editor-panel">

                <!-- PERSONS SECTION -->
                <details ?open=${!this._config.persons || this._config.persons.length === 0}>
                    <summary><h3 style="display: inline;">Persons</h3></summary>
                    <div style="margin-left: 1em;">
                        <div>
                            <label>Add person:</label>
                            <select @change=${this._addPerson}>
                                <option value="">Select a person...</option>
                                ${this.availablePersons.map(eid =>
                                    html`<option value=${eid}>${this.hass.states[eid]?.attributes?.friendly_name || eid}</option>`
                                )}
                            </select>
                        </div>
                        <div>
                            ${(this._config.persons || []).map((person, idx) => html`
                                <details style="margin-bottom: 1em; border: 1px solid #ccc; padding: 0.5em; border-radius: 4px;">
                                    <summary style="cursor: pointer; font-weight: bold;">
                                        ${person.name || this.hass.states[person.entity_id]?.attributes?.friendly_name || person.entity_id}
                                        <button @click=${(e: Event) => { e.preventDefault(); e.stopPropagation(); this._removePerson(idx); }}>Remove</button>
                                    </summary>
                                    <div style="margin-top: 0.5em;">
                                        <div>
                                            <label>Custom name (optional):</label>
                                            <input type="text" .value=${person.name || ''} @input=${(e: Event) => this._personNameChanged(idx, e)} placeholder="Leave empty to use entity name" />
                                        </div>

                                        <!-- Sensors -->
                                        <div>
                                            <strong>Sensors</strong>
                                            <p style="font-size: 0.9em; color: #666; margin: 0.25em 0 0.5em 0;">
                                                Add sensors with custom names to use in display conditions
                                            </p>
                                            <div class="sensor-list">
                                                ${person.namedSensors && Object.keys(person.namedSensors).length > 0
                                                    ? Object.entries(person.namedSensors).map(([name, sensor]) => html`
                                                        <div class="sensor-row">
                                                            <input type="text" value="${name}" placeholder="name" style="width: 150px;"
                                                                @blur=${(e: Event) => this._updateNamedSensorName(idx, name, (e.target as HTMLInputElement).value)} />
                                                            <input type="text" value="${Array.isArray(sensor.entity_id) ? sensor.entity_id.join(', ') : sensor.entity_id}" placeholder="entity_id" style="flex: 1;"
                                                                @blur=${(e: Event) => this._updateNamedSensorEntity(idx, name, (e.target as HTMLInputElement).value)} />
                                                            <input type="text" value="${sensor.attribute || ''}" placeholder="attribute (optional)" style="width: 120px;"
                                                                @blur=${(e: Event) => this._updateNamedSensorAttribute(idx, name, (e.target as HTMLInputElement).value)} />
                                                            <button class="icon-button" @click=${() => this._removeNamedSensor(idx, name)} title="Remove">&times;</button>
                                                        </div>
                                                    `) : ''}
                                            </div>
                                            <div style="margin-top: 0.5em;">
                                                <input type="text" id="new-sensor-name-${idx}" placeholder="Sensor name..." style="flex: 1; margin-right: 0.5em;"
                                                    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._addNamedSensorFromText(idx); }} />
                                                <button @click=${() => this._addNamedSensorFromText(idx)}>Add</button>
                                            </div>
                                        </div>

                                        <!-- Display Conditions -->
                                        <div style="margin-top: 1em;">
                                            <strong>Display Conditions</strong>
                                            <p style="font-size: 0.9em; color: #666; margin: 0.25em 0 0.5em 0;">
                                                Conditions for when this person is shown on the map. All top-level conditions must match (implicit AND).
                                            </p>
                                            <div class="conditions-list">
                                                ${(person.displayConditions || []).map((cond, cidx) =>
                                                    this._renderCondition(cond, `person:${idx}:${cidx}`, `person:${idx}` as ConditionContext)
                                                )}
                                            </div>
                                            <div class="add-condition-buttons">
                                                <button class="btn-small" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ sensor: 'distance', comparator: 'lt', value: '1000' });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ Value</button>
                                                <button class="btn-small" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ type: 'AND', conditions: [] });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ Group</button>
                                                <button class="btn-small" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ NOT</button>
                                            </div>
                                        </div>
                                `)}
                            </div>
                        </div>
                    </div>
                </details>

                <!-- DISPLAY CONDITIONS (Default) -->
                <details>
                    <summary><h3 style="display: inline;">Display Conditions (Default)</h3></summary>
                    <div style="margin-left: 1em;">
                        <p style="font-size: 0.9em; color: #666; margin-bottom: 0.5em;">
                            Default conditions applied to all persons unless they have their own conditions.
                        </p>
                        <div class="conditions-list">
                            ${(this._config.displayConditions || []).map((cond, cidx) =>
                                this._renderCondition(cond, `default:${cidx}`, 'default')
                            )}
                        </div>
                        <div class="add-condition-buttons">
                            <button class="btn-small" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ sensor: 'distance', comparator: 'lt', value: '1000' });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ Value</button>
                            <button class="btn-small" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ type: 'AND', conditions: [] });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ Group</button>
                            <button class="btn-small" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ NOT</button>
                        </div>
                    </div>

                    <div style="margin-top: 1em;">
                        <strong>Trail</strong>
                        <div style="margin-left: 1em; margin-top: 0.3em;">
                            <div>
                                <label>
                                    <input type="checkbox" .checked=${this._config.trail?.enabled ?? false} @change=${this._trailEnabledChanged} />
                                    Show history trail
                                </label>
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Max history age (minutes):</label>
                                <input type="number" .value=${this._config.trail?.max_age ?? 60} min="1" max="1440" @input=${this._trailMaxAgeChanged} style="width: 80px;" />
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Max trail distance (meters, 0 = use default rule):</label>
                                <input type="number" .value=${this._config.trail?.max_distance ?? ''} min="0" step="100" @input=${this._trailMaxDistanceChanged} style="width: 100px;" />
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Hide trail points within (meters of person):</label>
                                <input type="number" .value=${this._config.trail?.proximity ?? 50} min="0" step="10" @input=${this._trailProximityChanged} style="width: 80px;" />
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Newest point opacity:</label>
                                <input type="number" .value=${this._config.trail?.newest_opacity ?? 1} min="0" max="1" step="0.05" @input=${this._trailNewestOpacityChanged} style="width: 60px;" />
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Oldest point opacity:</label>
                                <input type="number" .value=${this._config.trail?.oldest_opacity ?? 0.3} min="0" max="1" step="0.05" @input=${this._trailOldestOpacityChanged} style="width: 60px;" />
                            </div>
                            <div style="margin-top: 0.5em;">
                                <label>Midpoint offset (0=steep then slow, 100=slow then steep):</label>
                                <input type="range" .value=${this._config.trail?.midpoint ?? 50} min="0" max="100" @input=${this._trailMidpointChanged} style="width: 150px; vertical-align: middle;" />
                                <span style="margin-left: 0.5em; font-size: 0.85em; color: #666;">${this._config.trail?.midpoint ?? 50}</span>
                            </div>
                            <div style="margin-top: 0.5em;">
                                <strong>Per-person colors</strong>
                                ${(this._config.persons || []).map(p => {
                                    const name = (p.name || this.hass?.states?.[p.entity_id]?.attributes?.friendly_name || p.entity_id);
                                    return html`
                                        <div style="display: flex; align-items: center; gap: 0.5em; margin-top: 0.25em;">
                                            <label style="min-width: 120px;">${name}</label>
                                            <input type="color" .value=${this._config.trail?.colors?.[p.entity_id] || TRAIL_COLORS[this._config.persons.indexOf(p) % TRAIL_COLORS.length]} @input=${(e: Event) => this._trailColorChanged(p.entity_id, e)} />
                                            <button @click=${() => this._trailColorReset(p.entity_id)} style="padding: 2px 6px; font-size: 0.8em;">Reset</button>
                                        </div>
                                    `;
                                })}
                            </div>
                        </div>
                    </div>
                </details>

                <!-- MAP CONFIGURATION -->
                <details>
                    <summary><h3 style="display: inline;">Map Configuration</h3></summary>
                    <div style="margin-left: 1em;">
                        <div>
                        <label>Map type:</label>
                             <select .value=${this._config.map?.type || 'color'} @change=${this._mapTypeChanged}>
                                 <option value="none">None</option>
                                 <option value="system">System (auto dark/light)</option>
                                 <option value="bw">Black & White (Stadia, requires API key)</option>
                                 <option value="light">Light (CartoDB)</option>
                                 <option value="color">Color (OSM)</option>
                                 <option value="dark">Dark (CartoDB)</option>
                                 <option value="voyager">Voyager (CartoDB)</option>
                                 <option value="satellite">Satellite (Esri)</option>
                                 <option value="topo">Topographic (OpenTopoMap)</option>
                                 <option value="outlines">Outlines (Stadia, requires API key)</option>
                             </select>
                        </div>
                        <div>
                            <label>Opacity:</label>
                            <input type="number" .value=${this._config.map?.opacity ?? 1} min="0" max="1" step="0.1" @input=${this._mapOpacityChanged} style="width: 60px;" />
                        </div>
                        <div>
                            <label>API Key (optional):</label>
                            <input type="text" .value=${this._config.map?.api_key || ''} @input=${this._mapApiKeyChanged} placeholder="For Stadia Maps" style="width: 200px;" />
                        </div>
                    </div>
                </details>

                <!-- ZOOM & CENTER -->
                <details>
                    <summary><h3 style="display: inline;">Zoom & Center</h3></summary>
                    <div style="margin-left: 1em;">
                        <div>
                            <label>Zoom level:</label>
                            <select .value=${this._config.zoom?.level ?? 13} @change=${this._zoomLevelChanged}>
                                ${VALID_ZOOM_LEVELS.map(level => html`<option value=${level} ?selected="${this._config.zoom?.level === level}">${level}${level === 10 ? ' (~20km)' : ''}</option>`)}
                            </select>
                        </div>
                        <div style="margin-top: 0.3em;">
                            <label>
                                <input type="checkbox" .checked=${this._config.zoom?.auto_level ?? false} @change=${this._zoomAutoChanged} />
                                Auto
                            </label>
                            <span style="font-size: 0.85em; color: #666; margin-left: 0.5em;">
                                ${this._config.center?.type === 'visible'
                                    ? '(automatic zoom and center on visible persons)'
                                    : '(automatic zoom to include all visible persons)'}
                            </span>
                        </div>
                        <div style="margin-top: 0.5em;">
                            <label>Center on:</label>
                            <select .value=${this._config.center?.type || 'user'} @change=${this._centerTypeChanged}>
                                <option value="user">User (logged in user)</option>
                                <option value="visible">Visible persons</option>
                                <option value="home">Home (zone)</option>
                                <option value="fixed">Fixed point</option>
                                ${(this._config.persons || []).map(p => html`
                                    <option value="person:${p.entity_id}">
                                        ${p.name || this.hass.states[p.entity_id]?.attributes?.friendly_name || p.entity_id}
                                    </option>
                                `)}
                            </select>
                        </div>

                        ${this._config.center?.type === 'home' ? html`
                        <div style="margin-top: 0.5em;">
                            <label>Home zone:</label>
                            <select .value=${this._config.center?.home_zone || ''} @change=${this._centerHomeZoneChanged}>
                                <option value="">Select zone...</option>
                                ${this.homeZones.map(eid => html`
                                    <option value=${eid} ?selected="${this._config.center?.home_zone === eid}">
                                        ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                                    </option>
                                `)}
                            </select>
                        </div>
                        ` : ''}

                        ${this._config.center?.type === 'fixed' ? html`
                        <div style="margin-top: 0.5em; display: flex; gap: 0.5em; align-items: center;">
                            <label>Coordinates:</label>
                            <input type="number" step="any" .value=${this._config.center?.fixed_coordinates?.lat || ''}
                                   @input=${(e: Event) => this._centerFixedCoordinatesChanged('lat', (e.target as HTMLInputElement).value)}
                                   placeholder="Lat" style="width: 100px;" />
                            <input type="number" step="any" .value=${this._config.center?.fixed_coordinates?.lon || ''}
                                   @input=${(e: Event) => this._centerFixedCoordinatesChanged('lon', (e.target as HTMLInputElement).value)}
                                   placeholder="Lon" style="width: 100px;" />
                            <button @click=${this._selectLocationOnMap}>Select on map</button>
                        </div>
                        ` : ''}

                        <div style="margin-top: 0.5em;">
                            <p style="font-size: 0.9em; color: #666;">
                                The current logged-in user is auto-detected for distance calculations.
                            </p>
                        </div>
                    </div>
                </details>

                <!-- DISPLAY -->
                <details>
                    <summary><h3 style="display: inline;">Display</h3></summary>
                    <div style="margin-left: 1em;">
                        <div>
                            <label>
                                <input type="checkbox" .checked=${this._config.show_title !== false} @change=${this._showTitleChanged} />
                                Show title
                            </label>
                            <input type="text" .value=${this._config.title || 'Lens Map'} ?disabled=${this._config.show_title === false} @input=${this._titleChanged} style="margin-left: 1em; width: 200px;" />
                        </div>
                        <div>
                            <label>
                                <input type="checkbox" .checked=${this._config.map?.interactive !== false} @change=${this._mapInteractiveChanged} />
                                Interactive (zoom, pan, scroll)
                            </label>
                        </div>
                        <div>
                            <label>
                                <input type="checkbox" .checked=${this._config.show_auto_zoom !== false} @change=${this._showAutoZoomChanged} />
                                Show auto zoom button
                            </label>
                        </div>
                        <div>
                            <label>
                                <input type="checkbox" .checked=${this._config.show_toggle_buttons !== false} @change=${this._showToggleButtonsChanged} />
                                Show toggle buttons
                            </label>
                        </div>
                    </div>
                </details>
                </div>
            </div>
        `;
    }

    static styles = css`
        .editor-container {
            padding: 16px;
            max-height: 500px;
            overflow-y: auto;
        }
        .editor-panel {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        details {
            border: 1px solid var(--divider-color);
            border-radius: 4px;
            padding: 8px;
        }
        summary {
            cursor: pointer;
            font-weight: bold;
        }
        h3 {
            margin: 0 0 8px 0;
            font-size: 1em;
        }
        label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-right: 8px;
        }
        input[type="text"], input[type="number"], select {
            padding: 4px 8px;
            border: 1px solid var(--divider-color);
            border-radius: 4px;
        }
        .sensor-row {
            display: flex;
            gap: 4px;
            margin-bottom: 4px;
            align-items: center;
        }
        .icon-button {
            padding: 4px 8px;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 1.2em;
        }
        button {
            padding: 6px 12px;
            background: var(--primary-color);
            color: var(--text-primary-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .btn-small {
            padding: 4px 8px;
            font-size: 0.85em;
            margin-right: 4px;
        }
        .conditions-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .condition-box {
            border-radius: 4px;
            border: 1px solid var(--divider-color);
            padding: 0;
            margin-bottom: 4px;
        }
        .condition-box.nested {
            margin-left: 16px;
        }
        .condition-box.condition-sensor {
            border-left: 3px solid #2196f3;
        }
        .condition-box.condition-group {
            border-left: 3px solid #ff9800;
        }
        .condition-box.condition-not {
            border-left: 3px solid #f44336;
        }
        .condition-summary {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            cursor: pointer;
            font-weight: normal;
        }
        .condition-badge {
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 0.75em;
            font-weight: bold;
            color: white;
            flex-shrink: 0;
        }
        .badge-sensor {
            background: #2196f3;
        }
        .badge-group {
            background: #ff9800;
        }
        .badge-not {
            background: #f44336;
        }
        .condition-text {
            flex: 1;
            font-family: monospace;
            font-size: 0.9em;
        }
        .remove-btn {
            background: none;
            color: #999;
            border: none;
            cursor: pointer;
            font-size: 1.2em;
            padding: 0 4px;
        }
        .remove-btn:hover {
            color: #f44336;
        }
        .condition-body {
            padding: 8px;
            border-top: 1px solid var(--divider-color);
        }
        .condition-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .condition-row label {
            min-width: 80px;
            font-size: 0.85em;
            color: #666;
        }
        .nested-conditions {
            margin-top: 8px;
        }
        .add-condition-buttons {
            margin-top: 8px;
        }
        .multi-select {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            padding: 2px 8px;
            border: 1px solid var(--divider-color);
            border-radius: 12px;
            font-size: 0.85em;
            cursor: pointer;
        }
        .chip.selected {
            background: var(--primary-color);
            color: var(--text-primary-color);
            border-color: var(--primary-color);
        }
        .chip input[type="checkbox"] {
            display: none;
        }
        .chip-remove {
            background: none;
            border: none;
            cursor: pointer;
            padding: 0 2px;
            font-size: 1em;
            line-height: 1;
        }
        .value-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
        }
    `;
}

customElements.define('lens-map-card-editor', LensMapCardEditor);
