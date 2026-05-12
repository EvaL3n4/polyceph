import { settings, saveSettings, availableProfiles, availablePresetsByApi, clearProfileState, getAvailableProfiles, getActivePipeline, createPipeline, duplicatePipeline, togglePipelineLock, movePipelineUp, movePipelineDown, addImportedPipeline, deletePipeline, refreshPresets } from '../state.js';
import { MODULE_NAME, VERSION } from '../constants.js';
import { generateId } from '../utils.js';
import { setLogLevel, logger } from '../logger.js';

import { updateChatSelectorOptions } from './chat-ui.js';
import { getEl, bindToggle, renderNeoSlider, syncHiddenMessageVisibility, SELECTORS } from './ui-shared.js';
import { updatePipelineEditorUI, bindStepEvents, setActiveStepIndex, activeStepIndex } from './settings/pipeline-editor/pipeline-editor.js';

import { getExtensionPath, getPopupModule } from '../compat-st.js';
import { showPromptPreview } from './settings/prompt-preview.js';
import { exportPipeline, importPipeline } from './settings/import-export.js';
import { renderPolycephThoughts } from './ui.js';
import { createPromptEditor } from './settings/prompt-editor.js';
import { mcpService } from '../engine/generator/services/mcp-service.js';

function getPresetOptionsHTMLNoCurrent(profileId, currentPreset) {
    const profile = availableProfiles.find(p => p.id === profileId);
    let apiId = profile?.api;
    if (!apiId) {
        apiId = SillyTavern.getContext().mainApi || '';
    }
    const presets = availablePresetsByApi[apiId] || [];
    const isValid = presets.includes(currentPreset);

    let html = '';
    if (!isValid && currentPreset) {
        html += `<option value="${currentPreset}" selected style="color: var(--red); font-weight: bold;">⚠️ ${currentPreset} (Incompatible)</option>`;
    }
    html += presets.map(p => {
        const isSelected = (isValid && p === currentPreset) ? 'selected' : '';
        return `<option value="${p}" ${isSelected}>${p}</option>`;
    }).join('');
    return html;
}

function renderProfileParams() {
    const container = getEl('polyceph_profile_params_container');
    if (!container) return;

    if (!settings.profileParams) settings.profileParams = [];

    let html = '';
    settings.profileParams.forEach((param, index) => {
        let profileOptions = availableProfiles.map(p => `<option value="${p.id}" ${p.id === param.profile ? 'selected' : ''}>${p.name}</option>`).join('');
        const presetOptions = getPresetOptionsHTMLNoCurrent(param.profile, param.preset);
        
        let isValidJson = true;
        try {
            if (param.json) JSON.parse(param.json);
        } catch (e) {
            isValidJson = false;
        }
        
        html += `
            <div class="polyceph-step-card" data-index="${index}" style="padding: 10px; margin-bottom: 5px;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <select class="text_pole polyceph-profile-param-profile" data-index="${index}" style="flex: 1;">
                        ${profileOptions}
                    </select>
                    <select class="text_pole polyceph-profile-param-preset" data-index="${index}" style="flex: 1;">
                        ${presetOptions}
                    </select>
                    <i class="fa-solid fa-trash polyceph-pointer polyceph-text-red polyceph-del-profile-param" data-index="${index}" title="Delete" style="align-self: center;"></i>
                </div>
                <textarea class="text_pole polyceph-profile-param-json" data-index="${index}" placeholder='{"key": "value"}' style="min-height: 60px; ${!isValidJson ? 'border-color: var(--red);' : ''}">${param.json || ''}</textarea>
                ${!isValidJson ? '<div style="color: var(--red); font-size: 0.8em; margin-top: 4px;">Invalid JSON</div>' : ''}
            </div>
        `;
    });

    container.innerHTML = html;

    // Bind events
    container.querySelectorAll('.polyceph-profile-param-profile').forEach(el => {
        el.addEventListener('change', (e) => {
            const index = e.target.getAttribute('data-index');
            settings.profileParams[index].profile = e.target.value;
            // Preset might be invalid now, so we clear it or keep it and let the warning show
            saveSettings();
            renderProfileParams(); // Re-render to update preset dropdown
        });
    });

    container.querySelectorAll('.polyceph-profile-param-preset').forEach(el => {
        el.addEventListener('change', (e) => {
            const index = e.target.getAttribute('data-index');
            settings.profileParams[index].preset = e.target.value;
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-profile-param-json').forEach(el => {
        el.addEventListener('input', (e) => {
            const index = e.target.getAttribute('data-index');
            settings.profileParams[index].json = e.target.value;
            saveSettings();
        });
        el.addEventListener('blur', () => {
            renderProfileParams(); // Re-render to show/hide validation error
        });
    });

    container.querySelectorAll('.polyceph-del-profile-param').forEach(el => {
        el.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            settings.profileParams.splice(index, 1);
            saveSettings();
            renderProfileParams();
        });
    });
}

let Popup = null;

/**
 * Updates the entire settings UI.
 */
export function updateUI() {
    updatePipelineEditorUI();
}

/**
 * Synchronizes the current settings state to the UI elements.
 */
function syncSettingsToUI() {
    const setChecked = (id, val) => {
        const el = getEl(id);
        if (el) el.checked = val;
    };
    const setValue = (id, val) => {
        const el = getEl(id);
        if (el) el.value = val;
    };

    // UI Settings
    setChecked('polyceph_show_selector_checkbox', settings.showPipelineSelector !== false);
    setChecked('polyceph_show_icon_checkbox', settings.showPipelineIcon !== false);
    setChecked('polyceph_compact_selector_checkbox', settings.compactSelectorMode);
    setChecked('polyceph_show_reasoning_checkbox', settings.showReasoning !== false);
    setChecked('polyceph_show_only_last_recursion_checkbox', settings.showOnlyLastRecursion);
    setChecked('polyceph_sticky_typing_checkbox', settings.stickyTypingIndicator);
    setChecked('polyceph_show_hidden_checkbox', settings.showHiddenMessages);
    setChecked('polyceph_continue_on_failure_checkbox', settings.continueOnFailure);

    // Behavior Settings
    setChecked('polyceph_restore_after_run_checkbox', settings.restore_after_run);
    setChecked('polyceph_intercept_send_checkbox', settings.interceptSend !== false);
    setChecked('polyceph_emulate_events_checkbox', settings.emulateCoreEvents);
    setValue('polyceph_enter_behavior_selector', settings.enterBehavior || 'all');
    setValue('polyceph_log_level_selector', settings.logLevel !== undefined ? settings.logLevel : 3);

    // Sliders
    const injectSlider = (containerId, label, id, val, min, max, step) => {
        const container = getEl(containerId);
        if (container) container.innerHTML = renderNeoSlider(label, id, val, min, max, step);
    };

    injectSlider('polyceph_delay_container', 'Request Delay (ms)', 'polyceph_delay', settings.delayMs || 0, 0, 5000, 50);
    injectSlider('polyceph_generation_timeout_container', 'Model Timeout (ms)', 'polyceph_generation_timeout', settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000, 0, 300000, 1000);
    injectSlider('polyceph_max_retries_container', 'Max Attempts', 'polyceph_max_retries', settings.maxRetries !== undefined ? settings.maxRetries : 3, 1, 10, 1);
    injectSlider('polyceph_retry_delay_container', 'Retry Delay (ms)', 'polyceph_retry_delay', settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000, 0, 10000, 100);
    injectSlider('polyceph_max_tool_retries_container', 'Tool Call Attempts', 'polyceph_max_tool_retries', settings.maxToolRetries !== undefined ? settings.maxToolRetries : 3, 1, 10, 1);
    injectSlider('polyceph_loop_threshold_container', 'Streaming Loop Detection Threshold', 'polyceph_loop_threshold', settings.loopDetectionThreshold !== undefined ? settings.loopDetectionThreshold : 3, 1, 10, 1);

    setValue('polyceph_prompt_input', settings.polycephPrompt || '');
    setValue('polyceph_mcp_servers_input', settings.mcpServers || '');
}

/**
 * Initializes the settings UI and binds all events.
 */
export async function addSettingsUI() {
    const container = getEl('extensions_settings');
    if (!container) return;

    const existing = getEl(SELECTORS.SETTINGS_CONTAINER);
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = SELECTORS.SETTINGS_CONTAINER;
    wrapper.classList.add('extension_container');

    // Initialize ST modules
    const popupModule = await getPopupModule();
    if (popupModule) Popup = popupModule.Popup;

    try {
        const basePath = getExtensionPath();
        const response = await fetch(`${basePath}/html/settings.html`);
        if (!response.ok) throw new Error('Failed to load settings.html');
        wrapper.innerHTML = await response.text();
    } catch (err) {

        console.error('[Polyceph] Error loading settings HTML:', err);
        wrapper.innerHTML = `<div style="padding: 20px; color: #ff4d4d;">Error loading Polyceph settings UI. Check console for details.</div>`;
    }

    container.appendChild(wrapper);

    // Sync state before binding events
    syncSettingsToUI();
    updateUI();
    updateMcpStatus();
    renderProfileParams();

    // Bind Global Settings
    const bindSlider = (id, settingKey) => {
        // We use event delegation or re-query because sliders were just injected
        const parent = wrapper;
        const slider = parent.querySelector('#' + id);
        const input = parent.querySelector('#' + id + '_value');
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
    bindSlider('polyceph_max_tool_retries', 'maxToolRetries');
    bindSlider('polyceph_loop_threshold', 'loopDetectionThreshold');

    // Global settings toggles
    getEl('polyceph_show_hidden_checkbox')?.addEventListener('change', (e) => {
        settings.showHiddenMessages = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    getEl('polyceph_continue_on_failure_checkbox')?.addEventListener('change', (e) => {
        settings.continueOnFailure = e.target.checked;
        saveSettings();
    });

    getEl('polyceph_show_reasoning_checkbox')?.addEventListener('change', (e) => {
        settings.showReasoning = e.target.checked;
        syncHiddenMessageVisibility();
        saveSettings();
    });

    getEl('polyceph_show_only_last_recursion_checkbox')?.addEventListener('change', (e) => {
        settings.showOnlyLastRecursion = e.target.checked;
        saveSettings();
        renderPolycephThoughts(true);
    });

    getEl('polyceph_sticky_typing_checkbox')?.addEventListener('change', (e) => {
        settings.stickyTypingIndicator = e.target.checked;
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

    createPromptEditor(getEl('polyceph_prompt_input'), (val) => {
        settings.polycephPrompt = val;
        saveSettings();
    });

    getEl('polyceph_mcp_servers_input')?.addEventListener('input', (e) => {
        settings.mcpServers = e.target.value;
        saveSettings();
    });

    bindToggle('polyceph_mcp_settings_toggle', 'polyceph_mcp_settings_content');

    getEl('polyceph_add_profile_param_btn')?.addEventListener('click', () => {
        if (!settings.profileParams) settings.profileParams = [];
        const defaultProfile = availableProfiles.length > 0 ? availableProfiles[0].id : '';
        const apiId = availableProfiles.find(p => p.id === defaultProfile)?.api || '';
        const defaultPreset = (availablePresetsByApi[apiId] && availablePresetsByApi[apiId].length > 0) ? availablePresetsByApi[apiId][0] : '';
        
        settings.profileParams.push({ profile: defaultProfile, preset: defaultPreset, json: '' });
        saveSettings();
        renderProfileParams();
    });
    bindToggle('polyceph_profile_params_toggle', 'polyceph_profile_params_content');

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

    getEl('polyceph_duplicate_pipeline_btn')?.addEventListener('click', () => {
        duplicatePipeline(settings.activePipelineId);
        updateUI();
    });

    getEl('polyceph_import_pipeline_btn')?.addEventListener('click', async () => {
        const imported = await importPipeline();
        if (imported) {
            addImportedPipeline(imported);
            updateUI();
        }
    });

    getEl('polyceph_export_pipeline_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        if (pipeline) {
            exportPipeline(pipeline);
        }
    });

    getEl('polyceph_lock_pipeline_btn')?.addEventListener('click', () => {
        togglePipelineLock(settings.activePipelineId);
        updateUI();
    });

    getEl('polyceph_move_up_pipeline_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        if (pipeline.isLocked) return;
        movePipelineUp(settings.activePipelineId);
        updateUI();
    });

    getEl('polyceph_move_down_pipeline_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        if (pipeline.isLocked) return;
        movePipelineDown(settings.activePipelineId);
        updateUI();
    });

    getEl('polyceph_del_pipeline_btn')?.addEventListener('click', async () => {
        const pipeline = getActivePipeline();
        if (pipeline.isLocked) return;

        const confirmed = await Popup.show.confirm(
            'Delete Pipeline',
            `Are you sure you want to delete the pipeline "${pipeline.name}"?<br>This cannot be undone.`
        );
        if (!confirmed) return;

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
    bindToggle('polyceph_pipeline_settings_toggle', 'polyceph_pipeline_settings_content');

    // Pipeline Steps
    getEl('polyceph_add_step_btn')?.addEventListener('click', () => {
        const pipeline = getActivePipeline();
        pipeline.steps.push({
            id: 'step_' + generateId(),
            tasks: [{ id: 'task_' + generateId(), profile: '', preset: 'Current', template: '{{user_input}}' }]
        });
        setActiveStepIndex(pipeline.steps.length - 1);

        saveSettings();
        updateUI();
    });

    getEl('polyceph_preview_prompts_btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';

        try {
            const pipeline = getActivePipeline();
            const currentStepIdx = activeStepIndex;
            let targetIdx = 0;

            if (pipeline && pipeline.steps[currentStepIdx]) {
                for (let i = 0; i < currentStepIdx; i++) {
                    targetIdx += pipeline.steps[i].tasks.length;
                }
            }

            await showPromptPreview(targetIdx);
        } catch (err) {
            toastr.error('Failed to generate prompt preview.');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });

    getEl('polyceph_refresh_profiles')?.addEventListener('click', async () => {
        await getAvailableProfiles();
        refreshPresets();
        const totalPresets = Object.values(availablePresetsByApi).flat().length;
        toastr.success(`Found ${availableProfiles.length} profiles, ${totalPresets} presets.`, 'Polyceph');
        updateUI();
    });

    // Listen for SillyTavern settings changes to update our UI warnings (e.g. Function Calling disabled)
    const context = SillyTavern.getContext();
    if (context.eventSource && context.eventTypes) {
        context.eventSource.on(context.eventTypes.CHAT_COMPLETION_SETTINGS_READY, () => {
            logger.debug('ST Chat Completion settings ready, refreshing Polyceph UI...');
            updateUI();
        });
    }
}

/**
 * Updates the MCP Hub status badge in the settings UI.
 */
async function updateMcpStatus() {
    const badge = getEl('polyceph_mcp_hub_badge');
    if (!badge) return;

    const available = await mcpService.checkHub();
    if (available) {
        badge.textContent = 'Connected';
        badge.className = 'polyceph-status-badge connected';
        // Auto-connect to MCP tool hub if found
        await mcpService.connectToHub();
    } else {
        badge.textContent = 'Not Connected';
        badge.className = 'polyceph-status-badge disconnected';
    }
}

