import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import { WhereaboutsMapCardConfig, PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig } from './whereabouts-map-card';
import { TRAIL_COLORS, migrateDisplayRules, migrateTrailConfig, type MapType } from './types';
import type { PersonSensors, TrailConfig, DisplayCondition, SensorCondition, GroupCondition, NotCondition, DefaultCondition, ConditionComparator } from './types';
import { isSensorCondition, isGroupCondition, isNotCondition, isDefaultCondition } from './condition-evaluator';
import { BUILT_IN_SENSORS } from './types';
import { TILE_PROVIDERS, requiresApiKey, getTileProvider } from './tileProviders';

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

type ConditionContext = 'default' | `person:${number}`;

export class WhereaboutsMapCardEditor extends LitElement {
    @property({ attribute: false }) public hass: any;
    @state() private _config: WhereaboutsMapCardConfig = { persons: [] };
    private _openSections: Set<string> = new Set(['persons']);
    private _openPersons: Set<number> = new Set();
    private _personsInitialized = false;

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

    setConfig(config: WhereaboutsMapCardConfig) {
        const safeConfig = config || { persons: [] };
        this._config = {
            ...safeConfig,
            displayConditions: safeConfig.displayConditions ||
                (safeConfig.display_rules ? migrateDisplayRules(safeConfig.display_rules) : [{ sensor: 'distance', comparator: 'lt', value: '1000' }]),
            map: safeConfig.map || { type: 'color', opacity: 1 },
            zoom: safeConfig.zoom || { level: 10, auto_level: false },
            center: safeConfig.center || { type: 'user' },
            trail: migrateTrailConfig(safeConfig.trail || { enabled: false, max_age: 60 }),
            show_auto_zoom: safeConfig.show_auto_zoom ?? true,
            show_toggle_buttons: safeConfig.show_toggle_buttons ?? true
        };

        for (const person of this._config.persons || []) {
            if (!person.displayConditions && person.displayRules) {
                person.displayConditions = migrateDisplayRules(person.displayRules);
            }
        }

        // Synchronize open-state for persons with the current config, preserving
        // any user toggles for persons that already existed.
        if (!this._personsInitialized) {
            const personCount = (this._config.persons || []).length;
            for (let i = 0; i < personCount; i++) {
                this._openPersons.add(i);
            }
            this._personsInitialized = true;
        }

        this.requestUpdate();
    }

    private _sectionToggleHandler(id: string, e: Event) {
        const details = e.currentTarget as HTMLDetailsElement;
        if (details.open) {
            this._openSections.add(id);
        } else {
            this._openSections.delete(id);
        }
    }

    private _personToggleHandler(idx: number, e: Event) {
        const details = e.currentTarget as HTMLDetailsElement;
        if (details.open) {
            this._openPersons.add(idx);
        } else {
            this._openPersons.delete(idx);
        }
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

    private _parsePath(path: string): { context: ConditionContext; indices: number[] } {
        const parts = path.split(':');
        const isPerson = parts[0] === 'person';
        const context = isPerson ? `${parts[0]}:${parts[1]}` as ConditionContext : 'default' as ConditionContext;
        const indices = (isPerson ? parts.slice(2) : parts.slice(1)).map(Number);
        return { context, indices };
    }

    private _updateConditionAtPath(path: string, updater: (c: DisplayCondition) => void) {
        const { context, indices } = this._parsePath(path);

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
        const { context, indices } = this._parsePath(parentPath);

        const conditions = JSON.parse(JSON.stringify(this._getConditions(context))) as DisplayCondition[];
        let current: DisplayCondition[] = conditions;
        for (let i = 0; i < indices.length; i++) {
            const c = current[indices[i]];
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
        const { context, indices } = this._parsePath(path);

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
        if (isDefaultCondition(condition)) {
            return 'Default conditions';
        }
        return 'Unknown';
    }

    private _getSensorOptions(context: ConditionContext): { group: string; value: string; label: string }[] {
        const options: { group: string; value: string; label: string }[] = [
            { group: 'Built-in', value: 'distance', label: 'Distance from user (m)' },
            { group: 'Built-in', value: 'distance_from_person', label: 'Distance from person (m)' },
            { group: 'Built-in', value: 'distance_from_zone', label: 'Distance from zone (m)' },
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
        if (sensor === 'distance' || sensor === 'distance_from_person' || sensor === 'distance_from_zone' || sensor === 'random') return NUMERIC_COMPARATORS;
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

        if (sensor === 'distance_from_person') {
            const isPerPersonContext = context !== 'default';
            return html`
                <div style="display: flex; gap: 4px; align-items: center;">
                    <select .value=${String(condition.target_person ?? '')}
                        @change=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                            (c as SensorCondition).target_person = (e.target as HTMLSelectElement).value || undefined;
                        })}>
                        <option value="">Select person...</option>
                        ${isPerPersonContext ? html`<option value="self" ?selected=${condition.target_person === 'self'}>Trailmaker</option>` : ''}
                        ${this._getWhoOptions().map(eid => html`
                            <option value="${eid}" ?selected=${condition.target_person === eid}>
                                ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                            </option>
                        `)}
                    </select>
                    <input type="number" min="0" step="10"
                        .value=${String(condition.value ?? '')}
                        @input=${(e: Event) => this._updateConditionAtPath(path, (c) => {
                            (c as SensorCondition).value = (e.target as HTMLInputElement).value;
                        })}
                        placeholder="meters" style="width: 80px;" />
                </div>`;
        }

        if (sensor === 'distance_from_zone') {
            const zone = condition.zone || { lat: 0, lon: 0 };
            return html`
                <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="number" step="any" .value=${zone.lat || ''}
                        @input=${(e: Event) => {
                            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
                            this._updateConditionAtPath(path, (c) => {
                                const sc = c as SensorCondition;
                                sc.zone = { ...sc.zone, lat: val, lon: sc.zone?.lon ?? 0 };
                            });
                        }}
                        placeholder="Lat" style="width: 80px;" />
                    <input type="number" step="any" .value=${zone.lon || ''}
                        @input=${(e: Event) => {
                            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
                            this._updateConditionAtPath(path, (c) => {
                                const sc = c as SensorCondition;
                                sc.zone = { ...sc.zone, lat: sc.zone?.lat ?? 0, lon: val };
                            });
                        }}
                        placeholder="Lon" style="width: 80px;" />
                </div>`;
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
                        <button class="small-button add-button" @click=${() => this._addConditionToPath(path, { sensor: 'distance', comparator: 'lt', value: '1000' })}>+ Value</button>
                        <button class="small-button add-button" @click=${() => this._addConditionToPath(path, { type: 'AND', conditions: [] })}>+ Group</button>
                        <button class="small-button add-button" @click=${() => this._addConditionToPath(path, { type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } })}>+ NOT</button>
                        ${context !== 'default' ? html`<button class="small-button add-button" @click=${() => this._addConditionToPath(path, { type: 'DEFAULT' } as DefaultCondition)}>+ Default</button>` : ''}
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

    private _renderDefaultCondition(condition: DefaultCondition, path: string) {
        return html`
            <details class="condition-box condition-default" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-default">DEFAULT</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
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
        if (isDefaultCondition(condition)) {
            return this._renderDefaultCondition(condition, path);
        }
        return html``;
    }

    private _renderTrailCondition(condition: DisplayCondition, path: string, context: string, isNested: boolean = false) {
        if (isSensorCondition(condition)) {
            return this._renderTrailSensorCondition(condition, path, context);
        }
        if (isGroupCondition(condition)) {
            return this._renderTrailGroupCondition(condition, path, context, isNested);
        }
        if (isNotCondition(condition)) {
            return this._renderTrailNotCondition(condition, path, context, isNested);
        }
        return html``;
    }

    private _renderTrailSensorCondition(condition: SensorCondition, path: string, context: string) {
        const sensorOptions = this._getSensorOptions(context as ConditionContext);
        const groups = [...new Set(sensorOptions.map(o => o.group))];
        const comparatorOptions = this._getComparatorOptions(condition.sensor);

        return html`
            <details class="condition-box condition-sensor" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-sensor">Value</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeTrailConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="condition-row">
                        <label>Sensor:</label>
                        <select .value=${condition.sensor}
                            @change=${(e: Event) => {
                                const newSensor = (e.target as HTMLSelectElement).value;
                                this._updateTrailConditionAtPath(path, (c) => {
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
                            @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
                                (c as SensorCondition).comparator = (e.target as HTMLSelectElement).value as ConditionComparator;
                            })}>
                            ${comparatorOptions.map(o => html`
                                <option value="${o.value}" ?selected=${condition.comparator === o.value}>${o.label}</option>
                            `)}
                        </select>
                    </div>
                    <div class="condition-row">
                        <label>Value:</label>
                        ${this._renderTrailConditionValueInput(condition, path)}
                    </div>
                </div>
            </details>`;
    }

    private _renderTrailConditionValueInput(condition: SensorCondition, path: string) {
        const { sensor } = condition;

        if (sensor === 'distance_from_person') {
            return html`
                <div style="display: flex; gap: 4px; align-items: center;">
                    <select .value=${String(condition.target_person ?? '')}
                        @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
                            (c as SensorCondition).target_person = (e.target as HTMLSelectElement).value || undefined;
                        })}>
                        <option value="">Select person...</option>
                        <option value="self" ?selected=${condition.target_person === 'self'}>Trailmaker</option>
                        ${this._getWhoOptions().map(eid => html`
                            <option value="${eid}" ?selected=${condition.target_person === eid}>
                                ${this.hass.states[eid]?.attributes?.friendly_name || eid}
                            </option>
                        `)}
                    </select>
                    <input type="number" min="0" step="10"
                        .value=${String(condition.value ?? '')}
                        @input=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
                            (c as SensorCondition).value = (e.target as HTMLInputElement).value;
                        })}
                        placeholder="meters" style="width: 80px;" />
                </div>`;
        }

        if (sensor === 'distance_from_zone') {
            const zone = condition.zone || { lat: 0, lon: 0 };
            return html`
                <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="number" step="any" .value=${zone.lat || ''}
                        @input=${(e: Event) => {
                            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
                            this._updateTrailConditionAtPath(path, (c) => {
                                const sc = c as SensorCondition;
                                sc.zone = { ...sc.zone, lat: val, lon: sc.zone?.lon ?? 0 };
                            });
                        }}
                        placeholder="Lat" style="width: 80px;" />
                    <input type="number" step="any" .value=${zone.lon || ''}
                        @input=${(e: Event) => {
                            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
                            this._updateTrailConditionAtPath(path, (c) => {
                                const sc = c as SensorCondition;
                                sc.zone = { ...sc.zone, lat: sc.zone?.lat ?? 0, lon: val };
                            });
                        }}
                        placeholder="Lon" style="width: 80px;" />
                </div>`;
        }

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
                                    this._updateTrailConditionAtPath(path, (c) => {
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
                    @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
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
                    @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
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
                    @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
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
                    @input=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
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
                                this._updateTrailConditionAtPath(path, (c) => {
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
                                    this._updateTrailConditionAtPath(path, (c) => {
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
                @input=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
                    (c as SensorCondition).value = (e.target as HTMLInputElement).value;
                })}
                placeholder="value" style="width: 100px;" />`;
    }

    private _renderTrailGroupCondition(condition: GroupCondition, path: string, context: string, isNested: boolean = false) {
        return html`
            <details class="condition-box condition-group ${isNested ? 'nested' : ''}" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-group">${condition.type}</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeTrailConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="condition-row">
                        <label>Logic:</label>
                        <select .value=${condition.type}
                            @change=${(e: Event) => this._updateTrailConditionAtPath(path, (c) => {
                                (c as GroupCondition).type = (e.target as HTMLSelectElement).value as 'AND' | 'OR';
                            })}>
                            <option value="AND" ?selected=${condition.type === 'AND'}>AND (all must match)</option>
                            <option value="OR" ?selected=${condition.type === 'OR'}>OR (any can match)</option>
                        </select>
                    </div>
                    <div class="nested-conditions">
                        ${condition.conditions.map((child, i) => this._renderTrailCondition(child, `${path}:${i}`, context, true))}
                    </div>
                    <div class="add-condition-buttons">
                        <button class="small-button add-button" @click=${() => this._addTrailConditionToPath(path, { sensor: 'distance_from_user', comparator: 'lte', value: '1000' })}>+ Value</button>
                        <button class="small-button add-button" @click=${() => this._addTrailConditionToPath(path, { type: 'AND', conditions: [] })}>+ Group</button>
                        <button class="small-button add-button" @click=${() => this._addTrailConditionToPath(path, { type: 'NOT', condition: { sensor: 'distance_from_user', comparator: 'lte', value: '1000' } })}>+ NOT</button>
                    </div>
                </div>
            </details>`;
    }

    private _renderTrailNotCondition(condition: NotCondition, path: string, context: string, isNested: boolean = false) {
        return html`
            <details class="condition-box condition-not ${isNested ? 'nested' : ''}" open>
                <summary class="condition-summary">
                    <span class="condition-badge badge-not">NOT</span>
                    <span class="condition-text">${this._getConditionSummary(condition)}</span>
                    <button class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this._removeTrailConditionAtPath(path); }} title="Remove">&times;</button>
                </summary>
                <div class="condition-body">
                    <div class="nested-conditions">
                        ${this._renderTrailCondition(condition.condition, `${path}:0`, context, true)}
                    </div>
                </div>
            </details>`;
    }

    private _addPerson(e: Event) {
        const select = e.target as HTMLSelectElement;
        const entityId = select.value;
        if (!entityId) return;

        const newPerson: PersonConfig = {
            entity_id: entityId,
        };

        const newIdx = (this._config.persons || []).length;
        this._config = {
            ...this._config,
            persons: [...(this._config.persons || []), newPerson]
        };
        this._openPersons.add(newIdx);
        select.value = '';
        this._emitConfigChanged();
    }

    private _removePerson(idx: number) {
        const persons = [...(this._config.persons || [])];
        persons.splice(idx, 1);
        this._config = { ...this._config, persons };
        const shifted = new Set<number>();
        for (const i of this._openPersons) {
            if (i === idx) continue;
            shifted.add(i > idx ? i - 1 : i);
        }
        this._openPersons = shifted;
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

    private _mapThemeTypeChanged(theme: 'light' | 'dark', e: Event) {
        const value = (e.target as HTMLSelectElement).value as MapType;
        this._config = { ...this._config, map: { ...this._config.map, [theme]: value } };
        this._emitConfigChanged();
    }

    private _mapThemeKeyChanged(theme: 'light' | 'dark', e: Event) {
        const value = (e.target as HTMLInputElement).value;
        this._config = { ...this._config, map: { ...this._config.map, [`${theme}_api_key`]: value } };
        this._emitConfigChanged();
    }

    private _themeMapOptionsHtml(selected: MapType) {
        const keyless = TILE_PROVIDERS.filter(p => p.group === 'keyless');
        const keyed = TILE_PROVIDERS.filter(p => p.group === 'keyed');
        const renderOption = (id: string, label: string, keyed: boolean) => html`
            <option value=${id} ?selected="${selected === id}">${label}${keyed ? ' (requires API key)' : ''}</option>`;
        return html`
            <optgroup label="No key required">
                ${keyless.map(p => renderOption(p.id, p.label, false))}
            </optgroup>
            <optgroup label="Requires API key">
                ${keyed.map(p => renderOption(p.id, p.label, true))}
            </optgroup>`;
    }

    private _mainMapOptionsHtml() {
        const selected = this._config.map?.type || 'color';
        const keyless = TILE_PROVIDERS.filter(p => p.group === 'keyless');
        const keyed = TILE_PROVIDERS.filter(p => p.group === 'keyed');
        const renderOption = (id: string, label: string, keyed: boolean) => html`
            <option value=${id} ?selected="${selected === id}">${label}${keyed ? ' (requires API key)' : ''}</option>`;
        return html`
            <option value="none" ?selected="${selected === 'none'}">None</option>
            <option value="system" ?selected="${selected === 'system'}">System (auto dark/light)</option>
            <optgroup label="No key required">
                ${keyless.map(p => renderOption(p.id, p.label, false))}
            </optgroup>
            <optgroup label="Requires API key">
                ${keyed.map(p => renderOption(p.id, p.label, true))}
            </optgroup>`;
    }

    private _apiKeyHelpHtml(mapId?: string) {
        if (!mapId) return '';
        const provider = getTileProvider(mapId);
        if (!provider?.helpUrl) return '';
        return html`
            <div class="help-text">
                ${provider.helpLead ? provider.helpLead + ' ' : ''}
                <a href=${provider.helpUrl} target="_blank" rel="noopener noreferrer">${provider.helpLinkLabel}</a>.
            </div>`;
    }

    private _themeApiKeyRowHtml(theme: 'light' | 'dark') {
        const mapId = theme === 'light'
            ? (this._config.map?.light || 'color')
            : (this._config.map?.dark || 'dark');
        const key = theme === 'light'
            ? this._config.map?.light_api_key
            : this._config.map?.dark_api_key;
        return html`
            <fieldset class="subsection">
                <legend>${theme === 'light' ? 'Light' : 'Dark'} Theme</legend>
                <div class="form-row">
                    <label>Map:</label>
                    <select .value=${mapId} @change=${(e: Event) => this._mapThemeTypeChanged(theme, e)}>
                        ${this._themeMapOptionsHtml(mapId)}
                    </select>
                </div>
                <div class="form-row">
                    <label>API Key${requiresApiKey(mapId) ? '' : ' (optional)'}:</label>
                    <div class="input-with-help">
                        <input type="text" class="full-width" .value=${key || ''} @input=${(e: Event) => this._mapThemeKeyChanged(theme, e)} placeholder="Paste your API key" />
                        ${requiresApiKey(mapId) ? this._apiKeyHelpHtml(mapId) : ''}
                    </div>
                </div>
            </fieldset>`;
    }

    private _zoomLevelChanged(e: Event) {
        const value = parseInt((e.target as HTMLSelectElement).value);
        this._config = { ...this._config, zoom: { ...this._config.zoom, level: value } };
        this._emitConfigChanged();
    }

    private _zoomAutoChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        const auto_level = value === 'fit' ? true : value === 'zoom_out' ? 'zoom_out' as const : false;
        this._config = { ...this._config, zoom: { ...this._config.zoom, auto_level } };
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

    private _trailGpsJumpFilterChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, trail: { ...this._config.trail, gps_jump_filter: checked || undefined } };
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

    private _staleEnabledChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, stale_after_hours: checked ? (this._config.stale_after_hours || 24) : undefined };
        this._emitConfigChanged();
    }

    private _staleHoursChanged(e: Event) {
        const value = parseInt((e.target as HTMLInputElement).value) || 24;
        this._config = { ...this._config, stale_after_hours: value };
        this._emitConfigChanged();
    }

    private _getTrailConditions(context: string): DisplayCondition[] {
        if (context === 'default' || context === 'trail_default') {
            return this._config.trail?.conditions || [];
        }
        if (context.startsWith('trail_person:')) {
            const personIdx = parseInt(context.split(':')[1]);
            const entityId = this._config.persons?.[personIdx]?.entity_id;
            if (!entityId) return [];
            return this._config.trail?.person_conditions?.[entityId] || [];
        }
        if (context.startsWith('person:')) {
            const personIdx = parseInt(context.split(':')[1]);
            const entityId = this._config.persons?.[personIdx]?.entity_id;
            if (!entityId) return [];
            return this._config.trail?.person_conditions?.[entityId] || [];
        }
        return [];
    }

    private _setTrailConditions(context: string, conditions: DisplayCondition[]) {
        const trail = { ...(this._config.trail || {}) };
        if (context === 'default' || context === 'trail_default') {
            trail.conditions = conditions;
        } else if (context.startsWith('trail_person:')) {
            const personIdx = parseInt(context.split(':')[1]);
            const entityId = this._config.persons?.[personIdx]?.entity_id;
            if (!entityId) return;
            trail.person_conditions = { ...(trail.person_conditions || {}), [entityId]: conditions };
        } else if (context.startsWith('person:')) {
            const personIdx = parseInt(context.split(':')[1]);
            const entityId = this._config.persons?.[personIdx]?.entity_id;
            if (!entityId) return;
            trail.person_conditions = { ...(trail.person_conditions || {}), [entityId]: conditions };
        } else {
            return;
        }
        this._config = { ...this._config, trail };
        this._emitConfigChanged();
    }

    private _updateTrailConditionAtPath(path: string, updater: (c: DisplayCondition) => void) {
        const parts = path.split(':');
        const context = parts[0] === 'trail_default' ? 'trail_default' : parts.slice(0, 2).join(':');
        const indices = (parts[0] === 'trail_default' ? parts.slice(1) : parts.slice(2)).map(Number);

        const conditions = JSON.parse(JSON.stringify(this._getTrailConditions(context))) as DisplayCondition[];
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
        this._setTrailConditions(context, conditions);
    }

    private _addTrailConditionToPath(parentPath: string, newCondition: DisplayCondition) {
        const parts = parentPath.split(':');
        const context = parts[0] === 'trail_default' ? 'trail_default' : parts.slice(0, 2).join(':');
        const indices = (parts[0] === 'trail_default' ? parts.slice(1) : parts.slice(2)).map(Number);

        const conditions = JSON.parse(JSON.stringify(this._getTrailConditions(context))) as DisplayCondition[];
        let current: DisplayCondition[] = conditions;
        for (let i = 0; i < indices.length; i++) {
            const c = current[indices[i]];
            if (isGroupCondition(c)) {
                current = c.conditions;
            } else if (isNotCondition(c)) {
                current = [c.condition];
            } else {
                return;
            }
        }
        current.push(newCondition);
        this._setTrailConditions(context, conditions);
    }

    private _removeTrailConditionAtPath(path: string) {
        const parts = path.split(':');
        const context = parts[0] === 'trail_default' ? 'trail_default' : parts.slice(0, 2).join(':');
        const indices = (parts[0] === 'trail_default' ? parts.slice(1) : parts.slice(2)).map(Number);

        const conditions = JSON.parse(JSON.stringify(this._getTrailConditions(context))) as DisplayCondition[];
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
        this._setTrailConditions(context, conditions);
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
                <details data-section-id="persons" ?open=${this._openSections.has('persons')} @toggle=${(e: Event) => this._sectionToggleHandler('persons', e)}>
                    <summary><h3>Persons</h3></summary>
                    <div class="section-content">
                        <div class="form-row">
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
                                <details class="item-box" data-section-id="person-${idx}" ?open=${this._openPersons.has(idx)} @toggle=${(e: Event) => this._personToggleHandler(idx, e)}>
                                    <summary class="item-header">
                                        <span>${person.name || this.hass.states[person.entity_id]?.attributes?.friendly_name || person.entity_id}</span>
                                        <button class="remove-button" @click=${(e: Event) => { e.preventDefault(); e.stopPropagation(); this._removePerson(idx); }}>Remove</button>
                                    </summary>
                                    <div class="section-content">
                                        <div class="form-row">
                                            <label>Custom name (optional):</label>
                                            <input type="text" .value=${person.name || ''} @input=${(e: Event) => this._personNameChanged(idx, e)} placeholder="Leave empty to use entity name" />
                                        </div>

                                        <!-- Sensors -->
                                        <div class="subsection">
                                            <legend>Named Sensors</legend>
                                            <p class="help-text">
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
                                            <div class="form-row inline" style="margin-top: 8px;">
                                                <input type="text" id="new-sensor-name-${idx}" placeholder="Sensor name..." style="flex: 1;"
                                                    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._addNamedSensorFromText(idx); }} />
                                                <button class="add-button" @click=${() => this._addNamedSensorFromText(idx)}>Add</button>
                                            </div>
                                        </div>

                                        <!-- Display Conditions -->
                                        <div class="subsection">
                                            <legend>Display Conditions</legend>
                                            <p class="help-text">
                                                Conditions for when this person is shown on the map. All top-level conditions must match (implicit AND).
                                            </p>
                                            <div class="conditions-list">
                                                ${(person.displayConditions || []).map((cond, cidx) =>
                                                    this._renderCondition(cond, `person:${idx}:${cidx}`, `person:${idx}` as ConditionContext)
                                                )}
                                            </div>
                                            <div class="add-condition-buttons">
                                                <button class="add-button" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ sensor: 'distance', comparator: 'lt', value: '1000' });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ Value</button>
                                                <button class="add-button" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ type: 'AND', conditions: [] });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ Group</button>
                                                <button class="add-button" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ NOT</button>
                                                <button class="add-button" @click=${() => {
                                                    const persons = [...(this._config.persons || [])];
                                                    const person = persons[idx];
                                                    if (!person.displayConditions) person.displayConditions = [];
                                                    person.displayConditions.push({ type: 'DEFAULT' });
                                                    this._config = { ...this._config, persons };
                                                    this._emitConfigChanged();
                                                }}>+ Default</button>
                                            </div>
                                        </div>

                                        <!-- Trail Point Conditions (per-person) -->
                                        <div class="subsection">
                                            <legend>Trail Point Conditions</legend>
                                            <p class="help-text">
                                                Override trail point conditions for this person. If empty, default trail conditions apply.
                                            </p>
                                            <div class="conditions-list">
                                                ${(this._config.trail?.person_conditions?.[person.entity_id] || []).map((cond, cidx) =>
                                                    this._renderTrailCondition(cond, `trail_person:${idx}:${cidx}`, `trail_person:${idx}`)
                                                )}
                                            </div>
                                            <div class="add-condition-buttons">
                                                <button class="add-button" @click=${() => {
                                                    const trail = { ...(this._config.trail || {}) };
                                                    if (!trail.person_conditions) trail.person_conditions = {};
                                                    if (!trail.person_conditions[person.entity_id]) trail.person_conditions[person.entity_id] = [];
                                                    trail.person_conditions[person.entity_id].push({ sensor: 'distance_from_user', comparator: 'lte', value: '1000' });
                                                    this._config = { ...this._config, trail };
                                                    this._emitConfigChanged();
                                                }}>+ Value</button>
                                                <button class="add-button" @click=${() => {
                                                    const trail = { ...(this._config.trail || {}) };
                                                    if (!trail.person_conditions) trail.person_conditions = {};
                                                    if (!trail.person_conditions[person.entity_id]) trail.person_conditions[person.entity_id] = [];
                                                    trail.person_conditions[person.entity_id].push({ type: 'AND', conditions: [] });
                                                    this._config = { ...this._config, trail };
                                                    this._emitConfigChanged();
                                                }}>+ Group</button>
                                                <button class="add-button" @click=${() => {
                                                    const trail = { ...(this._config.trail || {}) };
                                                    if (!trail.person_conditions) trail.person_conditions = {};
                                                    if (!trail.person_conditions[person.entity_id]) trail.person_conditions[person.entity_id] = [];
                                                    trail.person_conditions[person.entity_id].push({ type: 'NOT', condition: { sensor: 'distance_from_user', comparator: 'lte', value: '1000' } });
                                                    this._config = { ...this._config, trail };
                                                    this._emitConfigChanged();
                                                }}>+ NOT</button>
                                            </div>
                                        </div>
                                    </div>
                                </details>
                            `)}
                        </div>
                    </div>
                </details>

                <!-- DISPLAY CONDITIONS (Default) -->
                <details data-section-id="display-conditions" ?open=${this._openSections.has('display-conditions')} @toggle=${(e: Event) => this._sectionToggleHandler('display-conditions', e)}>
                    <summary><h3>Display Conditions (Default)</h3></summary>
                    <div class="section-content">
                        <p class="help-text">
                            Default conditions applied to all persons unless they have their own conditions.
                        </p>
                        <div class="conditions-list">
                            ${(this._config.displayConditions || []).map((cond, cidx) =>
                                this._renderCondition(cond, `default:${cidx}`, 'default')
                            )}
                        </div>
                        <div class="add-condition-buttons">
                            <button class="add-button" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ sensor: 'distance', comparator: 'lt', value: '1000' });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ Value</button>
                            <button class="add-button" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ type: 'AND', conditions: [] });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ Group</button>
                            <button class="add-button" @click=${() => {
                                const conds = [...(this._config.displayConditions || [])];
                                conds.push({ type: 'NOT', condition: { sensor: 'distance', comparator: 'lt', value: '1000' } });
                                this._config = { ...this._config, displayConditions: conds };
                                this._emitConfigChanged();
                            }}>+ NOT</button>
                        </div>
                    </div>

                    <div class="section-content">
                        <div class="subsection">
                            <legend>Show as stale</legend>
                            <div class="form-row">
                                <label>
                                    <input type="checkbox"
                                        .checked=${(this._config.stale_after_hours ?? 0) > 0}
                                        @change=${this._staleEnabledChanged} />
                                    Show stale markers in grayscale
                                </label>
                            </div>
                            ${(this._config.stale_after_hours ?? 0) > 0 ? html`
                                <div class="form-row">
                                    <label>Mark as stale after (hours):</label>
                                    <div class="inline">
                                        <input type="range" .value=${this._config.stale_after_hours ?? 24} min="1" max="72" step="1" @input=${this._staleHoursChanged} style="width: 150px; vertical-align: middle;" />
                                        <span class="help-text" style="margin: 0;">${this._config.stale_after_hours ?? 24} h</span>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="section-content">
                        <div class="subsection">
                            <legend>Trail</legend>
                            <div class="form-row">
                                <label>
                                    <input type="checkbox" .checked=${this._config.trail?.enabled ?? false} @change=${this._trailEnabledChanged} />
                                    Show history trail
                                </label>
                            </div>
                            <div class="form-row">
                                <label>Max trail age (minutes):</label>
                                <input type="number" .value=${this._config.trail?.max_age ?? 60} min="1" max="1440" @input=${this._trailMaxAgeChanged} />
                            </div>
                            <div class="form-row">
                                <label>
                                    <input type="checkbox" .checked=${this._config.trail?.gps_jump_filter ?? false} @change=${this._trailGpsJumpFilterChanged} />
                                    GPS jump filter
                                </label>
                            </div>
                            <div class="form-row">
                                <label>Newest point opacity:</label>
                                <input type="number" .value=${this._config.trail?.newest_opacity ?? 1} min="0" max="1" step="0.05" @input=${this._trailNewestOpacityChanged} />
                            </div>
                            <div class="form-row">
                                <label>Oldest point opacity:</label>
                                <input type="number" .value=${this._config.trail?.oldest_opacity ?? 0.3} min="0" max="1" step="0.05" @input=${this._trailOldestOpacityChanged} />
                            </div>
                            <div class="form-row">
                                <label>Midpoint offset (0=steep then slow, 100=slow then steep):</label>
                                <div class="inline">
                                    <input type="range" .value=${this._config.trail?.midpoint ?? 50} min="0" max="100" @input=${this._trailMidpointChanged} style="width: 150px; vertical-align: middle;" />
                                    <span class="help-text" style="margin: 0;">${this._config.trail?.midpoint ?? 50}</span>
                                </div>
                            </div>
                            <div class="form-row">
                                <label>Per-person colors</label>
                                ${(this._config.persons || []).map(p => {
                                    const name = (p.name || this.hass?.states?.[p.entity_id]?.attributes?.friendly_name || p.entity_id);
                                    return html`
                                        <div style="display: flex; align-items: center; gap: 0.5em; margin-top: 0.25em;">
                                            <label style="min-width: 120px;">${name}</label>
                                            <input type="color" .value=${this._config.trail?.colors?.[p.entity_id] || TRAIL_COLORS[this._config.persons.indexOf(p) % TRAIL_COLORS.length]} @input=${(e: Event) => this._trailColorChanged(p.entity_id, e)} />
                                            <button class="small-button" @click=${() => this._trailColorReset(p.entity_id)} style="padding: 2px 6px; font-size: 0.8em;">Reset</button>
                                        </div>
                                    `;
                                })}
                            </div>
                        </div>

                        <div class="subsection">
                            <legend>Trail Point Conditions (Default)</legend>
                            <p class="help-text">
                                Conditions applied to each trail point to control visibility. All top-level conditions must match (implicit AND).
                            </p>
                            <div class="conditions-list">
                                ${(this._config.trail?.conditions || []).map((cond, cidx) =>
                                    this._renderTrailCondition(cond, `trail_default:${cidx}`, 'trail_default')
                                )}
                            </div>
                            <div class="add-condition-buttons">
                                <button class="add-button" @click=${() => {
                                    const trail = { ...(this._config.trail || {}) };
                                    if (!trail.conditions) trail.conditions = [];
                                    trail.conditions.push({ sensor: 'distance_from_user', comparator: 'lte', value: '1000' });
                                    this._config = { ...this._config, trail };
                                    this._emitConfigChanged();
                                }}>+ Value</button>
                                <button class="add-button" @click=${() => {
                                    const trail = { ...(this._config.trail || {}) };
                                    if (!trail.conditions) trail.conditions = [];
                                    trail.conditions.push({ type: 'AND', conditions: [] });
                                    this._config = { ...this._config, trail };
                                    this._emitConfigChanged();
                                }}>+ Group</button>
                                <button class="add-button" @click=${() => {
                                    const trail = { ...(this._config.trail || {}) };
                                    if (!trail.conditions) trail.conditions = [];
                                    trail.conditions.push({ type: 'NOT', condition: { sensor: 'distance_from_user', comparator: 'lte', value: '1000' } });
                                    this._config = { ...this._config, trail };
                                    this._emitConfigChanged();
                                }}>+ NOT</button>
                            </div>
                        </div>
                    </div>
                </details>

                <!-- MAP CONFIGURATION -->
                <details data-section-id="map-configuration" ?open=${this._openSections.has('map-configuration')} @toggle=${(e: Event) => this._sectionToggleHandler('map-configuration', e)}>
                    <summary><h3>Map Configuration</h3></summary>
                    <div class="section-content">
                        <div class="form-row">
                            <label>Map type:</label>
                            <select .value=${this._config.map?.type || 'color'} @change=${this._mapTypeChanged}>
                                ${this._mainMapOptionsHtml()}
                            </select>
                        </div>
                        ${this._config.map?.type === 'system'
                            ? html`${this._themeApiKeyRowHtml('light')}${this._themeApiKeyRowHtml('dark')}`
                            : html`
                                <div class="form-row">
                                    <label>API Key${requiresApiKey(this._config.map?.type) ? '' : ' (optional)'}:</label>
                                    <div class="input-with-help">
                                        <input type="text" class="full-width" .value=${this._config.map?.api_key || ''} @input=${this._mapApiKeyChanged} placeholder="Paste your API key" />
                                        ${requiresApiKey(this._config.map?.type) ? this._apiKeyHelpHtml(this._config.map?.type) : ''}
                                    </div>
                                </div>`}
                        <div class="form-row">
                            <label>Opacity:</label>
                            <input type="number" .value=${this._config.map?.opacity ?? 1} min="0" max="1" step="0.1" @input=${this._mapOpacityChanged} />
                        </div>
                    </div>
                </details>

                <!-- ZOOM & CENTER -->
                <details data-section-id="zoom-center" ?open=${this._openSections.has('zoom-center')} @toggle=${(e: Event) => this._sectionToggleHandler('zoom-center', e)}>
                    <summary><h3>Zoom & Center</h3></summary>
                    <div class="section-content">
                        <div class="form-row">
                            <label>Zoom level:</label>
                            <select .value=${this._config.zoom?.level ?? 13} @change=${this._zoomLevelChanged}>
                                ${VALID_ZOOM_LEVELS.map(level => html`<option value=${level} ?selected="${this._config.zoom?.level === level}">${level}${level === 10 ? ' (~20km)' : ''}</option>`)}
                            </select>
                        </div>
                        <div class="form-row">
                            <label>Auto zoom:</label>
                            <select .value=${this._config.zoom?.auto_level === true ? 'fit' : this._config.zoom?.auto_level === 'zoom_out' ? 'zoom_out' : 'off'} @change=${this._zoomAutoChanged}>
                                <option value="off">Off</option>
                                <option value="fit">Yes (fit all)</option>
                                <option value="zoom_out">Zoom out only</option>
                            </select>
                            <span class="help-text">
                                ${this._config.center?.type === 'visible'
                                    ? this._config.zoom?.auto_level === 'zoom_out' ? '(zoom out to show all visible persons, never zoom in)' : '(automatic zoom and center on visible persons)'
                                    : this._config.zoom?.auto_level === 'zoom_out' ? '(zoom out to show all visible persons, never zoom in)' : '(automatic zoom to include all visible persons)'}
                            </span>
                        </div>
                        <div class="form-row">
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
                        <div class="form-row">
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
                        <div class="form-row">
                            <label>Coordinates:</label>
                            <div class="inline">
                                <input type="number" step="any" .value=${this._config.center?.fixed_coordinates?.lat || ''}
                                       @input=${(e: Event) => this._centerFixedCoordinatesChanged('lat', (e.target as HTMLInputElement).value)}
                                       placeholder="Lat" />
                                <input type="number" step="any" .value=${this._config.center?.fixed_coordinates?.lon || ''}
                                       @input=${(e: Event) => this._centerFixedCoordinatesChanged('lon', (e.target as HTMLInputElement).value)}
                                       placeholder="Lon" />
                                <button class="add-button" @click=${this._selectLocationOnMap}>Select on map</button>
                            </div>
                        </div>
                        ` : ''}

                        <p class="help-text">
                            The current logged-in user is auto-detected for distance calculations.
                        </p>
                    </div>
                </details>

                <!-- DISPLAY -->
                <details data-section-id="display" ?open=${this._openSections.has('display')} @toggle=${(e: Event) => this._sectionToggleHandler('display', e)}>
                    <summary><h3>Display</h3></summary>
                    <div class="section-content">
                        <div class="form-row">
                            <label>
                                <input type="checkbox" .checked=${this._config.show_title !== false} @change=${this._showTitleChanged} />
                                Show title
                            </label>
                            <input type="text" .value=${this._config.title || 'Whereabouts Map'} ?disabled=${this._config.show_title === false} @input=${this._titleChanged} />
                        </div>
                        <div class="form-row">
                            <label>
                                <input type="checkbox" .checked=${this._config.map?.interactive !== false} @change=${this._mapInteractiveChanged} />
                                Interactive (zoom, pan, scroll)
                            </label>
                        </div>
                        <div class="form-row">
                            <label>
                                <input type="checkbox" .checked=${this._config.show_auto_zoom !== false} @change=${this._showAutoZoomChanged} />
                                Show auto zoom button
                            </label>
                        </div>
                        <div class="form-row">
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
            position: relative;
            z-index: 1000;
            background: var(--card-background-color, #fff);
        }
        .editor-panel {
            display: flex;
            flex-direction: column;
        }
        details {
            margin-bottom: 12px;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;
            padding: 6px;
        }
        details summary {
            cursor: pointer;
            user-select: none;
            font-weight: bold;
        }
        summary {
            padding: 6px;
            margin: -6px;
            border-radius: 3px;
        }
        summary:hover {
            background: var(--secondary-background-color, #f0f0f0);
        }
        h3 {
            display: inline;
            margin: 0;
            font-size: 1em;
        }
        h4 {
            margin: 12px 0 6px 0;
            font-size: 0.95em;
            font-weight: 600;
            color: var(--secondary-text-color, #666);
        }
        summary h4 {
            display: inline;
            margin: 0;
        }
        details details {
            margin-bottom: 8px;
            border: 1px solid var(--divider-color, #e0e0e0);
            background: var(--secondary-background-color, #f5f5f5);
        }
        details details summary {
            padding: 4px;
            margin: -4px;
        }
        details details .section-content {
            padding: 8px 6px 6px 6px;
        }
        .section-content {
            padding: 12px 6px 6px 6px;
        }
        .subsection {
            margin-bottom: 12px;
            padding: 8px;
            border: 1px solid var(--divider-color, #e0e0e0);
            border-radius: 4px;
            background: var(--secondary-background-color, #f5f5f5);
        }
        .subsection legend {
            padding: 0 6px;
            font-size: 0.95em;
            font-weight: 600;
            color: var(--secondary-text-color, #666);
        }
        .form-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 10px;
        }
        .form-row label {
            font-weight: 500;
            font-size: 0.9em;
            color: var(--secondary-text-color, #666);
        }
        .form-row .inline {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
        }
        input[type="text"],
        input[type="number"],
        input[type="color"],
        select,
        textarea {
            padding: 6px 8px;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
        }
        input[type="number"] {
            max-width: 120px;
        }
        input[type="checkbox"] {
            width: 18px;
            height: 18px;
        }
        .full-width {
            width: 100%;
            box-sizing: border-box;
        }
        textarea.full-width {
            min-height: 60px;
        }
        .help-text {
            color: var(--secondary-text-color, #666);
            font-size: 0.85em;
            margin: 2px 0;
            line-height: 1.3;
        }
        .input-with-help {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
        }
        .input-with-help .full-width {
            flex: 1;
            min-width: 0;
        }
        .input-with-help .help-text {
            flex: 0 0 auto;
            max-width: 60%;
            margin: 0;
        }
        .item-box {
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;
            padding: 0;
            margin-bottom: 8px;
            background: var(--secondary-background-color, #f5f5f5);
        }
        .item-box summary.item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            margin: 0;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            list-style: none;
            font-size: 0.9em;
        }
        .item-box summary.item-header::-webkit-details-marker {
            display: none;
        }
        .item-box summary.item-header::before {
            content: '▶';
            font-size: 9px;
            margin-right: 6px;
            transition: transform 0.2s;
        }
        .item-box[open] summary.item-header::before {
            transform: rotate(90deg);
        }
        .item-box summary.item-header:hover {
            background: rgba(0, 0, 0, 0.03);
        }
        .item-box .section-content {
            padding: 0 8px 8px 8px;
        }
        .button-group {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
        }
        button {
            padding: 5px 10px;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;
            background: var(--card-background-color, #fff);
            color: var(--primary-text-color);
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background: var(--secondary-background-color, #f0f0f0);
        }
        .add-button {
            background: var(--primary-color, #03a9f4);
            color: white;
            border: none;
        }
        .add-button:hover {
            background: var(--dark-primary-color, #0288d1);
        }
        .remove-button {
            background: var(--error-color, #f44336);
            color: white;
            border: none;
        }
        .remove-button:hover {
            background: #d32f2f;
        }
        .small-button {
            font-size: 11px;
            padding: 3px 6px;
        }
        .icon-button {
            padding: 3px 6px;
            font-weight: bold;
            background: none;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;
            cursor: pointer;
        }
        .sensor-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
        }
        .sensor-row {
            display: flex;
            gap: 4px;
            margin-bottom: 4px;
            align-items: center;
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
            background: var(--card-background-color, #fff);
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
        .condition-box.condition-default {
            border-left: 3px solid #9c27b0;
        }
        .condition-summary {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            cursor: pointer;
            user-select: none;
            font-weight: normal;
            list-style: none;
        }
        .condition-summary::-webkit-details-marker {
            display: none;
        }
        .condition-summary::before {
            content: '▶';
            font-size: 9px;
            margin-right: 6px;
            transition: transform 0.2s;
            flex-shrink: 0;
        }
        .condition-box[open] > .condition-summary::before {
            transform: rotate(90deg);
        }
        .condition-summary:hover {
            background: rgba(0, 0, 0, 0.02);
        }
        .condition-badge {
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 0.7em;
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
        .badge-default {
            background: #9c27b0;
        }
        .condition-text {
            flex: 1;
            font-family: monospace;
            font-size: 0.9em;
            color: var(--secondary-text-color, #666);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
            background: none;
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
            color: var(--secondary-text-color, #666);
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

customElements.define('whereabouts-map-card-editor', WhereaboutsMapCardEditor);
