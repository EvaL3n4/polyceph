import { settings, saveSettings, availableProfiles, availablePresetsByApi, clearProfileState, getAvailableProfiles, getActivePipeline, createPipeline, deletePipeline, refreshPresets } from '../state.js';
import { MODULE_NAME, VERSION } from '../constants.js';
import { generateId } from '../utils.js';
import { setLogLevel } from '../logger.js';
import { updateChatSelectorOptions } from './chat-ui.js';
import { getEl, bindToggle, renderNeoSlider, syncHiddenMessageVisibility, SELECTORS } from './ui-shared.js';
import { updatePipelineEditorUI, bindStepEvents } from './settings/pipeline-editor.js';
import { showPromptPreview } from './settings/prompt-preview.js';

/**
 * Updates the entire settings UI.
 */
export function updateUI() {
    updatePipelineEditorUI();
}

/**
 * Generates the main settings HTML structure.
 */
export function createSettingsHTML() {
    return `
        <div class="polyceph-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Polyceph</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="polyceph-header">
                        Reasoning pipeline options:
                    </div>
                    
                    <div class="polyceph-settings-section">
                        <div class="polyceph-settings-section-header" id="polyceph_ui_settings_toggle">
                            <span>UI Settings</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                        <div class="polyceph-settings-section-content" id="polyceph_ui_settings_content">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_show_selector_checkbox" ${settings.showPipelineSelector !== false ? 'checked' : ''}>
                                <label for="polyceph_show_selector_checkbox" style="cursor: pointer;">Show Pipeline Selector in Input Bar</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_show_icon_checkbox" ${settings.showPipelineIcon !== false ? 'checked' : ''}>
                                <label for="polyceph_show_icon_checkbox" style="cursor: pointer;">Show Pipeline Selector Icon</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_compact_selector_checkbox" ${settings.compactSelectorMode ? 'checked' : ''}>
                                <label for="polyceph_compact_selector_checkbox" style="cursor: pointer;">Compact Pipeline Selector</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_show_reasoning_checkbox" ${settings.showReasoning !== false ? 'checked' : ''}>
                                <label for="polyceph_show_reasoning_checkbox" style="cursor: pointer;">Show Polyceph Reasoning Blocks</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_show_hidden_checkbox" ${settings.showHiddenMessages ? 'checked' : ''}>
                                <label for="polyceph_show_hidden_checkbox" style="cursor: pointer;">Show Hidden Background Messages</label>
                            </div>
                        </div>
                    </div>

                    <div class="polyceph-settings-section">
                        <div class="polyceph-settings-section-header" id="polyceph_behavior_settings_toggle">
                            <span>Behavior Settings</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                        <div class="polyceph-settings-section-content" id="polyceph_behavior_settings_content">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_restore_after_run_checkbox" ${settings.restore_after_run ? 'checked' : ''}>
                                <label for="polyceph_restore_after_run_checkbox" style="cursor: pointer;">Restore Profile & Preset after Run</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_intercept_send_checkbox" ${settings.interceptSend !== false ? 'checked' : ''}>
                                <label for="polyceph_intercept_send_checkbox" style="cursor: pointer;">Intercept Send Button (Single Send Button)</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="polyceph_emulate_events_checkbox" ${settings.emulateCoreEvents ? 'checked' : ''}>
                                <label for="polyceph_emulate_events_checkbox" style="cursor: pointer;" title="Allows third-party extensions (like Tracker Enhanced) to interact with Polyceph runs.">Emulate Core Generation Events (Ext. Compat)</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                                <b style="min-width: 120px; font-size: 0.9em; opacity: 0.8;" title="Capture Enter key behavior. PC: Only on desktop. Mobile: Only on touch. All: Everywhere. None: Disable Enter capture.">Enter Key</b>
                                <select id="polyceph_enter_behavior_selector" class="text_pole" style="flex: 1;">
                                    <option value="pc" ${settings.enterBehavior === 'pc' ? 'selected' : ''}>PC Capture</option>
                                    <option value="mobile" ${settings.enterBehavior === 'mobile' ? 'selected' : ''}>Mobile Capture</option>
                                    <option value="all" ${settings.enterBehavior === 'all' || settings.enterBehavior === undefined ? 'selected' : ''}>All Capture</option>
                                    <option value="none" ${settings.enterBehavior === 'none' ? 'selected' : ''}>No Capture</option>
                                </select>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                                <b style="min-width: 120px; font-size: 0.9em; opacity: 0.8;" title="Control the verbosity of console logs.">Log Level</b>
                                <select id="polyceph_log_level_selector" class="text_pole" style="flex: 1;">
                                    <option value="0" ${settings.logLevel === 0 ? 'selected' : ''}>None</option>
                                    <option value="1" ${settings.logLevel === 1 ? 'selected' : ''}>Error</option>
                                    <option value="2" ${settings.logLevel === 2 ? 'selected' : ''}>Warn</option>
                                    <option value="3" ${settings.logLevel === 3 ? 'selected' : ''}>Info</option>
                                    <option value="4" ${settings.logLevel === 4 ? 'selected' : ''}>Debug</option>
                                </select>
                            </div>
                            <div style="margin-top: 10px;">
                                ${renderNeoSlider('Tool Recursion Limit', 'polyceph_tool_recursion_limit', settings.toolRecursionLimit || 5, 0, 20, 1)}
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label for="polyceph_prompt_input" style="font-weight: bold; display: block; margin-bottom: 5px;">Polyceph Prompt</label>
                        <textarea id="polyceph_prompt_input" class="text_pole" style="width: 100%; min-height: 80px; font-family: monospace;" placeholder="Global context or instructions...">${settings.polycephPrompt || ''}</textarea>
                    </div>
                    
                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Request Delay (ms)', 'polyceph_delay', settings.delayMs || 0, 0, 5000, 50)}
                        ${renderNeoSlider('Model Timeout (ms)', 'polyceph_generation_timeout', settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000, 0, 300000, 1000)}
                    </div>

                    <div style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 15px;">
                        ${renderNeoSlider('Max Retries', 'polyceph_max_retries', settings.maxRetries !== undefined ? settings.maxRetries : 3, 0, 10, 1)}
                        ${renderNeoSlider('Retry Delay (ms)', 'polyceph_retry_delay', settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000, 0, 10000, 100)}
                    </div>

                    <button id="polyceph_refresh_profiles" class="menu_button" style="margin-bottom: 15px;">
                        <i class="fa-solid fa-refresh"></i> Refresh Profiles
                    </button>

                    <div class="polyceph-placeholders-container">
                        <div class="polyceph-placeholders-header" id="polyceph_placeholders_toggle">
                            <b>Available Placeholders</b>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                        <div class="polyceph-placeholders-content" id="polyceph_placeholders_content">
                            <ul style="margin: 0; padding-left: 20px;">
                                <li><code>{{user_input}}</code> - Original text from the send box.</li>
                                <li><code>{{chat_history}}</code> - All chat messages - see below for advanced use.</li>
                                <li><code>{{s1}}</code>, <code>{{s2}}</code> - Combined output of all tasks in a previous Step.</li>
                                <li><code>{{TaskLabel}}</code> - Output of a specific task (using its custom label).</li>
                                <li><code>{{system_prompt}}</code> - The Main Prompt from SillyTavern Advanced Formatting.</li>
                                <li><code>{{polyceph_prompt}}</code> - The global Polyceph Prompt defined above.</li>
                                <li><code>{{char}}</code>, <code>{{user}}</code>, <code>{{persona}}</code>, <code>{{personality}}</code> - Standard character macros.</li>
                                <li><code>{{wi}}</code> or <code>{{world_info}}</code> - **Reactive** Lorebook entries (scanned per-task).</li>
                                <li><code>{{wi|before}}</code> / <code>{{wi|after}}</code> - Injects only the specific World Info section.</li>
                                <li><code>{{cc_all_prompts}}</code> - Comprehensive ST prompt list (includes all enabled markers, injections, history, examples).</li>
                                <li><code>{{cc_main_prompt}}</code>, <code>{{cc_aux_prompt}}</code> - Specific CC Prompts.</li>
                                <li><code>{{cc_post_history_instructions}}</code> - CC Post-History instructions.</li>
                                <li><code>{{cc_enhance_definitions}}</code> - CC Enhance Definitions prompt.</li>
                            </ul>
                            <div style="margin-top: 10px; border-top: 1px solid var(--white10a); padding-top: 10px;">
                                <b style="font-size: 0.9em; opacity: 0.8;">Advanced: Chat History</b>
                                <div style="font-size: 0.85em; opacity: 0.9; margin-top: 5px;">
                                    Format: <code>{{chat_history|last:10|bg_last:2|live:true}}</code>
                                    <ul style="margin: 5px 0 0 0; padding-left: 15px;">
                                        <li><code>last:N</code> - Limit total messages to N.</li>
                                        <li><code>bg_last:N</code> - Keep only the last N background messages (interspersed).</li>
                                        <li><code>live:true</code> - Use chat *during* pipeline runs, not a snapshot of prior to the run. (includes pipeline results).</li>
                                    </ul>
                                </div>
                            </div>
                            <div style="margin-top: 10px; border-top: 1px solid var(--white10a); padding-top: 10px;">
                                <b style="font-size: 1em; opacity: 0.8;">Post-Processing Tags (in Model Output)</b>
                                <ul style="margin: 5px 0 0 0; padding-left: 20px; font-size: 0.9em; opacity: 0.9;">
                                    <li><code>&lt;think&gt;...&lt;/think&gt;</code> - Stripped if "Strip Thinking" is enabled on the task.</li>
                                    <li><code>&lt;ramble&gt;...&lt;/ramble&gt;</code> - Renders as a reasoning card.</li>
                                    <li><code>&lt;background&gt;...&lt;/background&gt;</code> - Renders as a hidden background message.</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div class="polyceph-step-card polyceph-pipeline-manager" style="margin-top: 20px;">
                        <div class="polyceph-step-header" style="display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <b style="min-width: 120px;">Active Pipeline</b>
                                <select id="polyceph_pipeline_selector" class="text_pole" style="flex: 1;"></select>
                                <i id="polyceph_new_pipeline_btn" class="fa-solid fa-plus" style="cursor: pointer; margin-left: 5px;" title="Create New Pipeline"></i>
                                <i id="polyceph_del_pipeline_btn" class="fa-solid fa-trash" style="cursor: pointer; margin-left: 5px; color: #ff4d4d;" title="Delete Current Pipeline"></i>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <b style="min-width: 120px;">Pipeline Name</b>
                                <input type="text" id="polyceph_active_pipeline_name" class="text_pole" style="flex: 1; padding: 2px 5px;" placeholder="Pipeline Name..." />
                            </div>
                        </div>
                    </div>

                    <div id="polyceph_steps_container" class="polyceph-step-list"></div>

                    <button id="polyceph_add_step_btn" class="menu_button">
                        <i class="fa-solid fa-plus"></i> Add Pipeline Step
                    </button>

                    <button id="polyceph_preview_prompts_btn" class="menu_button" style="background-color: var(--black70a);">
                        <i class="fa-solid fa-eye"></i> Preview Assembled Prompts
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Initializes the settings UI and binds all events.
 */
export function addSettingsUI() {
    const container = getEl('extensions_settings');
    if (!container) return;

    const existing = getEl(SELECTORS.SETTINGS_CONTAINER);
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = SELECTORS.SETTINGS_CONTAINER;
    wrapper.innerHTML = createSettingsHTML();
    container.appendChild(wrapper);

    updateUI();

    // Bind Global Settings
    const bindSlider = (id, settingKey) => {
        const slider = getEl(id);
        const input = getEl(id + '_value');
        if (!slider || !input) return;

        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            input.value = val;
            settings[settingKey] = parseInt(val) || 0;
            saveSettings();
        });

        input.addEventListener('change', (e) => {
            const val = e.target.value;
            slider.value = val;
            settings[settingKey] = parseInt(val) || 0;
            saveSettings();
        });
    };

    bindSlider('polyceph_delay', 'delayMs');
    bindSlider('polyceph_generation_timeout', 'generationTimeoutMs');
    bindSlider('polyceph_max_retries', 'maxRetries');
    bindSlider('polyceph_retry_delay', 'retryDelayMs');
    bindSlider('polyceph_tool_recursion_limit', 'toolRecursionLimit');

    // Global settings toggles
    getEl('polyceph_show_hidden_checkbox')?.addEventListener('change', (e) => {
        settings.showHiddenMessages = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    getEl('polyceph_show_reasoning_checkbox')?.addEventListener('change', (e) => {
        settings.showReasoning = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    getEl('polyceph_restore_after_run_checkbox')?.addEventListener('change', (e) => {
        settings.restore_after_run = e.target.checked;
        saveSettings();
    });

    getEl('polyceph_intercept_send_checkbox')?.addEventListener('change', (e) => {
        settings.interceptSend = e.target.checked;
        saveSettings();
        if (SillyTavern.getContext().eventSource) {
            SillyTavern.getContext().eventSource.emit('polyceph-settings-changed');
        }
    });

    getEl('polyceph_enter_behavior_selector')?.addEventListener('change', (e) => {
        settings.enterBehavior = e.target.value;
        saveSettings();
    });

    getEl('polyceph_emulate_events_checkbox')?.addEventListener('change', (e) => {
        settings.emulateCoreEvents = e.target.checked;
        saveSettings();
    });

    getEl('polyceph_log_level_selector')?.addEventListener('change', (e) => {
        settings.logLevel = parseInt(e.target.value);
        setLogLevel(settings.logLevel);
        saveSettings();
    });

    getEl('polyceph_show_selector_checkbox')?.addEventListener('change', (e) => {
        settings.showPipelineSelector = e.target.checked;
        saveSettings();
        if (SillyTavern.getContext().eventSource) SillyTavern.getContext().eventSource.emit('polyceph-settings-changed');
    });

    getEl('polyceph_show_icon_checkbox')?.addEventListener('change', (e) => {
        settings.showPipelineIcon = e.target.checked;
        saveSettings();
        if (SillyTavern.getContext().eventSource) SillyTavern.getContext().eventSource.emit('polyceph-settings-changed');
    });

    getEl('polyceph_compact_selector_checkbox')?.addEventListener('change', (e) => {
        settings.compactSelectorMode = e.target.checked;
        saveSettings();
        if (SillyTavern.getContext().eventSource) SillyTavern.getContext().eventSource.emit('polyceph-settings-changed');
    });

    getEl('polyceph_prompt_input')?.addEventListener('input', (e) => {
        settings.polycephPrompt = e.target.value;
        saveSettings();
    });

    // Pipeline Manager Events
    getEl(SELECTORS.SETTINGS_SELECTOR)?.addEventListener('change', (e) => {
        settings.activePipelineId = e.target.value;
        saveSettings();
        updateUI();
    });

    getEl('polyceph_new_pipeline_btn')?.addEventListener('click', () => {
        createPipeline();
        updateUI();
    });

    getEl('polyceph_del_pipeline_btn')?.addEventListener('click', () => {
        if (deletePipeline(settings.activePipelineId)) {
            updateUI();
        } else {
            toastr.error('Cannot delete the last pipeline.', 'Polyceph');
        }
    });

    getEl(SELECTORS.NAME_INPUT)?.addEventListener('input', (e) => {
        const pipeline = getActivePipeline();
        if (pipeline) {
            pipeline.name = e.target.value;
            saveSettings();
            const selector = getEl(SELECTORS.SETTINGS_SELECTOR);
            const opt = selector?.querySelector(`option[value="${pipeline.id}"]`);
            if (opt) opt.textContent = pipeline.name;
        }
    });

    // Drawer Toggles
    bindToggle('polyceph_placeholders_toggle', 'polyceph_placeholders_content');
    bindToggle('polyceph_ui_settings_toggle', 'polyceph_ui_settings_content');
    bindToggle('polyceph_behavior_settings_toggle', 'polyceph_behavior_settings_content');

    // Pipeline Steps
    getEl('polyceph_add_step_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        pipeline.steps.push({
            id: 'step_' + generateId(),
            tasks: [{ id: 'task_' + generateId(), profile: '', preset: 'Current', template: '{{user_input}}' }]
        });
        saveSettings();
        updateUI();
    });

    getEl('polyceph_preview_prompts_btn')?.addEventListener('click', async () => {
        await showPromptPreview();
    });

    getEl('polyceph_refresh_profiles')?.addEventListener('click', async () => {
        await getAvailableProfiles();
        refreshPresets();
        const totalPresets = Object.values(availablePresetsByApi).flat().length;
        toastr.success(`Found ${availableProfiles.length} profiles, ${totalPresets} presets.`, 'Polyceph');
        updateUI();
    });
}
