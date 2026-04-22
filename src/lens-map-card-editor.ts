import { LitElement, html, css } from 'lit';
import { property, state } from 'lit/decorators.js';
import { LensMapCardConfig, PersonConfig, DisplayRule, MapConfig, ZoomConfig, CenterConfig } from './lens-map-card';
import type { PersonSensors } from './types';

const VALID_MAPS = ['bw', 'color', 'dark', 'outlines', 'system'];
const VALID_ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

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

    private _getOperatorsForSensor(sensor: string): { value: string; label: string }[] {
        if (sensor === 'distance') {
            return [
                { value: '<', label: '<' },
                { value: '<=', label: '≤' },
                { value: '>', label: '>' },
                { value: '>=', label: '≥' },
            ];
        }
        return [
            { value: 'is', label: 'is' },
            { value: 'isNot', label: 'is not' },
            { value: 'oneOf', label: 'is one of' },
            { value: 'notOneOf', label: 'is not one of' },
            { value: 'unknown', label: 'is unknown' },
            { value: 'known', label: 'is known' },
        ];
    }

    private _shouldHideValue(sensor: string, operator: string): boolean {
        return operator === 'unknown' || operator === 'known';
    }

    setConfig(config: LensMapCardConfig) {
        this._config = {
            ...config,
            display_rules: config.display_rules || [
                { id: 'default', priority: 1, sensor: 'distance', operator: '<', value: '1000', enabled: true }
            ],
            map: config.map || { type: 'color', opacity: 1 },
            zoom: config.zoom || { level: 10, auto_level: false },
            center: config.center || { use_current_user: true }
        };
        this.requestUpdate();
    }

    private _addPerson(e: Event) {
        const select = e.target as HTMLSelectElement;
        const entityId = select.value;
        if (!entityId) return;

        const newPerson: PersonConfig = {
            entity_id: entityId,
            displayRules: this._config.display_rules?.filter(r => r.id !== 'default') || []
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

    private _addDisplayRule(personIdx: number) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (!person.displayRules) {
            person.displayRules = [];
        }
        const newRule: DisplayRule = {
            id: `rule_${Date.now()}`,
            priority: person.displayRules.length + 1,
            sensor: 'distance',
            operator: '<',
            value: '1000',
            enabled: true
        };
        person.displayRules.push(newRule);
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _updateDisplayRuleKey(personIdx: number, ruleIdx: number, key: keyof DisplayRule, value: any) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (person.displayRules?.[ruleIdx]) {
            (person.displayRules[ruleIdx] as any)[key] = value;
            this._config = { ...this._config, persons };
            this._emitConfigChanged();
        }
    }

    private _removeDisplayRule(personIdx: number, ruleIdx: number) {
        const persons = [...(this._config.persons || [])];
        const person = persons[personIdx];
        if (person.displayRules) {
            person.displayRules.splice(ruleIdx, 1);
        }
        this._config = { ...this._config, persons };
        this._emitConfigChanged();
    }

    private _defaultRuleSensorChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        const display_rules = [...(this._config.display_rules || [])];
        const defaultRule = display_rules.find(r => r.id === 'default');
        if (defaultRule) {
            defaultRule.sensor = value;
        } else {
            display_rules.push({ id: 'default', priority: 1, sensor: value, operator: '<', value: '1000', enabled: true });
        }
        this._config = { ...this._config, display_rules };
        this._emitConfigChanged();
    }

    private _defaultRuleValueChanged(e: Event) {
        const value = (e.target as HTMLInputElement).value;
        const display_rules = [...(this._config.display_rules || [])];
        const defaultRule = display_rules.find(r => r.id === 'default');
        if (defaultRule) {
            defaultRule.value = value;
        } else {
            display_rules.push({ id: 'default', priority: 1, sensor: 'distance', operator: '<', value, enabled: true });
        }
        this._config = { ...this._config, display_rules };
        this._emitConfigChanged();
    }

    private _defaultRuleOperatorChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value as DisplayRule['operator'];
        const display_rules = [...(this._config.display_rules || [])];
        const defaultRule = display_rules.find(r => r.id === 'default');
        if (defaultRule) {
            defaultRule.operator = value;
        } else {
            display_rules.push({ id: 'default', priority: 1, sensor: 'distance', operator: value, value: '1000', enabled: true });
        }
        this._config = { ...this._config, display_rules };
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

    private _currentUserChanged(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        this._config = { ...this._config, current_user: value };
        this._emitConfigChanged();
    }

    private _centerUseCurrentUserChanged(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this._config = { ...this._config, center: { ...this._config.center, use_current_user: checked } };
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
                                                Add sensors with custom names to use in display rules
                                            </p>
                                            <div class="sensor-list">
                                                ${person.namedSensors && Object.keys(person.namedSensors).length > 0
                                                    ? Object.entries(person.namedSensors).map(([name, sensor]) => html`
                                                        <div class="sensor-row">
                                                            <input type="text" value="${name}" placeholder="name" style="width: 150px;"
                                                                @blur=${(e: Event) => this._updateNamedSensorName(idx, name, (e.target as HTMLInputElement).value)} />
                                                            <input type="text" value="${Array.isArray(sensor.entity_id) ? sensor.entity_id.join(', ') : sensor.entity_id}" placeholder="entity_id" style="flex: 1;"
                                                                @blur=${(e: Event) => this._updateNamedSensorEntity(idx, name, (e.target as HTMLInputElement).value)} />
                                                            <button class="icon-button" @click=${() => this._removeNamedSensor(idx, name)} title="Remove">🗑️</button>
                                                        </div>
                                                    `) : ''}
                                            </div>
                                            <div style="margin-top: 0.5em;">
                                                <input type="text" id="new-sensor-name-${idx}" placeholder="Sensor name..." style="flex: 1; margin-right: 0.5em;"
                                                    @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._addNamedSensorFromText(idx); }} />
                                                <button @click=${() => this._addNamedSensorFromText(idx)}>Add</button>
                                            </div>
                                        </div>

                                        <!-- Display Rules -->
                                        <div style="margin-top: 1em;">
                                            <strong>Display Rules</strong>
                                            <p style="font-size: 0.9em; color: #666; margin: 0.25em 0 0.5em 0;">
                                                Rules for when this person is shown on the map
                                            </p>
                                            <div>
                                                ${(person.displayRules || []).map((rule, ridx) => html`
                                                    <div style="display: flex; gap: 0.5em; align-items: center; margin-bottom: 0.5em;">
                                                        <select .value=${rule.sensor} @change=${(e: Event) => {
                                                            const newSensor = (e.target as HTMLSelectElement).value;
                                                            this._updateDisplayRuleKey(idx, ridx, 'sensor', newSensor);
                                                            const operators = this._getOperatorsForSensor(newSensor);
                                                            if (!operators.some(op => op.value === rule.operator)) {
                                                                this._updateDisplayRuleKey(idx, ridx, 'operator', operators[0].value);
                                                            }
                                                        }}>
                                                            <option value="distance" ?selected="${rule.sensor === 'distance'}">distance</option>
                                                            <option value="state" ?selected="${rule.sensor === 'state'}">state</option>
                                                            ${this.uniqueNamedSensors.map(sn => html`<option value="${sn}" ?selected="${rule.sensor === sn}">${sn}</option>`)}
                                                        </select>
                                                        <select .value=${rule.operator} @change=${(e: Event) => this._updateDisplayRuleKey(idx, ridx, 'operator', (e.target as HTMLSelectElement).value)}>
                                                            ${this._getOperatorsForSensor(rule.sensor).map(op => html`<option value="${op.value}" ?selected="${rule.operator === op.value}">${op.label}</option>`)}
                                                        </select>
                                                        ${this._shouldHideValue(rule.sensor, rule.operator) ? '' : html`
                                                            <input type="text" .value=${rule.value} placeholder="value" style="width: 80px;"
                                                                @input=${(e: Event) => this._updateDisplayRuleKey(idx, ridx, 'value', (e.target as HTMLInputElement).value)} />
                                                        `}
                                                        <button class="icon-button" @click=${() => this._removeDisplayRule(idx, ridx)} title="Remove">🗑️</button>
                                                    </div>
                                                `)}
                                            </div>
                                            <button @click=${() => this._addDisplayRule(idx)}>+ Add Rule</button>
                                        </div>
                                    </div>
                                </details>
                            `)}
                        </div>
                    </div>
                </details>

                <!-- DISPLAY RULES (Default) -->
                <details>
                    <summary><h3 style="display: inline;">Display Rules (Default)</h3></summary>
                    <div style="margin-left: 1em;">
                        <p style="font-size: 0.9em; color: #666; margin-bottom: 0.5em;">
                            Default rule applied to all persons unless they have their own rules.
                        </p>
                        <div style="display: flex; gap: 0.5em; align-items: center;">
                            <span>Show when</span>
                            <select .value=${this._config.display_rules?.find(r => r.id === 'default')?.sensor || 'distance'} @change=${this._defaultRuleSensorChanged}>
                                <option value="distance">distance</option>
                                <option value="state">state</option>
                                ${this.uniqueNamedSensors.map(sn => html`<option value="${sn}">${sn}</option>`)}
                            </select>
                            <select .value=${this._config.display_rules?.find(r => r.id === 'default')?.operator || '<'} @change=${this._defaultRuleOperatorChanged}>
                                ${this._getOperatorsForSensor(this._config.display_rules?.find(r => r.id === 'default')?.sensor || 'distance').map(op => html`<option value="${op.value}" ?selected="${(this._config.display_rules?.find(r => r.id === 'default')?.operator || '<') === op.value}">${op.label}</option>`)}
                            </select>
                            ${this._shouldHideValue(this._config.display_rules?.find(r => r.id === 'default')?.sensor || 'distance', this._config.display_rules?.find(r => r.id === 'default')?.operator || '<') ? '' : html`
                                <input type="text" .value=${this._config.display_rules?.find(r => r.id === 'default')?.value || '1000'} @input=${this._defaultRuleValueChanged} placeholder="value" style="width: 80px;" />
                                <span>m</span>
                            `}
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
                                <option value="bw">Black & White (Stamen)</option>
                                <option value="color">Color (OSM)</option>
                                <option value="dark">Dark (CartoDB)</option>
                                <option value="outlines">Outlines (Stamen)</option>
                                <option value="system">System (auto-detect)</option>
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
                            <label style="margin-left: 1em;">
                                <input type="checkbox" .checked=${this._config.zoom?.auto_level ?? false} @change=${this._zoomAutoChanged} />
                                Auto
                            </label>
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
                            <label>Current user (reference for distance):</label>
                            <select .value=${this._config.current_user || ''} @change=${this._currentUserChanged}>
                                <option value="">Select...</option>
                                ${(this._config.persons || []).map(p => html`
                                    <option value=${p.entity_id} ?selected="${this._config.current_user === p.entity_id}">
                                        ${p.name || this.hass.states[p.entity_id]?.attributes?.friendly_name || p.entity_id}
                                    </option>
                                `)}
                            </select>
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
        }
        button {
            padding: 6px 12px;
            background: var(--primary-color);
            color: var(--text-primary-color);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
    `;
}

customElements.define('lens-map-card-editor', LensMapCardEditor);