import { availableProfiles, availablePresetsByApi, getActivePipeline } from '../../../state.js';
import { isChatCompletionApi } from '../../../compat-chat.js';
import { getPresetSettings } from '../../../compat-presets.js';

/**
 * Generates HTML for the preset dropdown based on the selected profile's API.
 */
export function getPresetOptionsHTML(profileId, currentPreset) {
    const profile = availableProfiles.find(p => p.id === profileId);
    let apiId = profile?.api;

    if (!apiId) {
        apiId = SillyTavern.getContext().mainApi || '';
    }

    const presets = availablePresetsByApi[apiId] || [];
    const isCurrent = !currentPreset || currentPreset === 'Current';
    const isValid = isCurrent || presets.includes(currentPreset);

    let html = `<option value="Current" ${isCurrent ? 'selected' : ''}>Current Preset</option>`;

    // If the saved preset is missing from this API, add a warning entry
    if (!isCurrent && !isValid) {
        html += `<option value="${currentPreset}" selected style="color: var(--red); font-weight: bold;">⚠️ ${currentPreset} (Incompatible)</option>`;
    }

    html += presets.map(p => {
        const isSelected = (!isCurrent && isValid && p === currentPreset) ? 'selected' : '';
        return `<option value="${p}" ${isSelected}>${p}</option>`;
    }).join('');

    return html;
}

/**
 * Renders the options bar for a task based on its type and API.
 */
export function renderTaskOptionsBar(task, apiId, disabled) {
    if (!apiId || apiId === 'none') return '';

    const isCC = isChatCompletionApi(apiId);

    // Resolve which settings to check for function calling
    const presetName = task.preset || 'Current';
    const presetSettings = (presetName === 'Current')
        ? SillyTavern.getContext().chatCompletionSettings
        : getPresetSettings(presetName, apiId);

    const isFunctionCallingDisabled = presetSettings?.function_calling === false;
    let html = '';

    if ((task.outputType === 'tool' || task.outputType === 'mcp') && isCC) {
        html = `
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-skip-recursion-checkbox" data-node-id="${task.id}" ${task.skipSuccessRecursion ? 'checked' : ''} title="If checked, the task will end immediately after successful tool calls, skipping the model's final response." ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">No Success Recursion</label>
            </div>
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-hide-success-checkbox" data-node-id="${task.id}" ${task.hideSuccessResponse ? 'checked' : ''} title="If checked, this task will return an empty string regardless of LLM output. Useful for background tool processors." ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Hide Success Response</label>
            </div>
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-hide-tool-history-checkbox" data-node-id="${task.id}" ${task.hideToolHistory ? 'checked' : ''} title="If checked, only the tool results are included in the output. If unchecked, the assistant's thoughts and tool calls are preserved." ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Hide Tool History</label>
            </div>
            ${isFunctionCallingDisabled ? `
                </div>
            ` : ''}
            ${task.outputType === 'mcp' ? `
                <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                    <div class="polyceph-mcp-sources-trigger menu_button" data-node-id="${task.id}" style="padding: 4px 8px; white-space: nowrap; cursor: pointer; display: flex; align-items: center; gap: 5px;" title="Select MCP tool sources for this task">
                        <span>Sources (${(task.mcpSources || ['MCP Tool Hub']).length})</span>
                        <i class="fa-solid fa-chevron-down" style="font-size: 0.8em; opacity: 0.8;"></i>
                    </div>
                </div>
            ` : ''}
        `;
    } else if ((task.outputType === 'thinking' || task.outputType === 'character') && isCC) {
        html = `
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-streaming-checkbox" data-node-id="${task.id}" ${task.streaming !== false ? 'checked' : ''} title="Enable streaming for this task" ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Streaming</label>
            </div>
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-antiloop-checkbox" data-node-id="${task.id}" ${task.antiLoop !== false ? 'checked' : ''} title="Abort generation if the model starts looping" ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Anti-Loop</label>
            </div>
        `;
    }


    if (!html) return '';

    return `
        <div class="polyceph-task-options-bar" data-node-id="${task.id}" style="display: flex; align-items: center; gap: 15px; padding: 4px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; margin-top: 4px; flex-wrap: wrap;">
            ${html}
        </div>
    `;
}

/**
 * Renders the HTML for a single task node.
 */
export function renderTask(stepId, task, isLocked = false) {
    const profileId = task.profile || 'none';
    const profile = availableProfiles.find(p => p.id === profileId);
    const apiId = profileId === 'none' ? 'none' : (profile?.api || SillyTavern.getContext().mainApi || '');
    const isCC = profileId !== 'none' && isChatCompletionApi(apiId);

    const profileFound = profileId === 'none' || !!profile;
    let profileOptions = `<option value="none" ${profileId === 'none' ? 'selected' : ''}>(Template Only - No LLM)</option>`;

    if (!profileFound && task.profile) {
        profileOptions += `<option value="${task.profile}" selected style="color: var(--red); font-weight: bold;">⚠️ ${task.profile} (Missing Profile)</option>`;
    }

    profileOptions += availableProfiles.map(p => `<option value="${p.id}" ${p.id === task.profile ? 'selected' : ''}>${p.name}</option>`).join('');

    const presetOptions = getPresetOptionsHTML(task.profile, task.preset);
    const disabled = isLocked ? 'disabled' : '';

    const optionsBarHtml = renderTaskOptionsBar(task, apiId, disabled);

    return `
        <div class="polyceph-node-card ${isLocked ? 'polyceph-locked' : ''}" data-node-id="${task.id}">
            <div class="polyceph-node-header" style="display: flex; flex-direction: column; gap: 8px;">
                <div class="polyceph-node-header-label-row">
                    <input type="text" class="polyceph-node-label-input text_pole" data-node-id="${task.id}" placeholder="Task Label..." value="${task.label || ''}" style="flex: 1; min-width: 100px; padding: 2px 5px;" ${disabled} />
                    ${isLocked ? '' : `<i class="fa-solid fa-trash polyceph-del-node" data-node-id="${task.id}" data-step-id="${stepId}" style="cursor: pointer; color: #ff4d4d;" title="Delete Task"></i>`}
                </div>

                <div class="polyceph-node-header-controls">
                    <select class="polyceph-profile-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;" ${disabled}>
                        ${profileOptions}
                    </select>
                    <select class="polyceph-preset-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;" title="Override the API preset for this task" ${disabled}>
                        ${presetOptions}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 15px; padding-left: 2px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <label>Task Type</label>
                        <select class="polyceph-node-output-type text_pole" data-step-id="${stepId}" data-node-id="${task.id}" ${disabled}>
                            <option value="character" ${task.outputType === 'character' ? 'selected' : ''}>Character Message</option>
                            <option value="thinking" ${task.outputType === 'thinking' ? 'selected' : ''}>Reasoning</option>
                            ${isCC ? `<option value="tool" ${task.outputType === 'tool' ? 'selected' : ''}>Tool Processor</option>` : ''}
                            ${isCC ? `<option value="mcp" ${task.outputType === 'mcp' ? 'selected' : ''}>MCP</option>` : ''}
                            <option value="internal" ${task.outputType === 'internal' ? 'selected' : ''}>Internal (Hidden)</option>
                        </select>

                    </div>
                </div>
                ${optionsBarHtml}
            </div>
            <div class="polyceph-textarea-container">
                <textarea id="polyceph-template-${task.id}" class="polyceph-node-template text_pole" data-step="${stepId}" data-node="${task.id}" placeholder="Use {{user_input}} or {{chat_history:2}}..." ${disabled}>${task.template || ''}</textarea>
                ${isLocked ? '' : `<i class="editor_maximize fa-solid fa-maximize right_menu_button sttt--enabled interactable" data-for="polyceph-template-${task.id}" data-i18n="[title]Expand the editor" data-sttt--title="Expand the editor" tabindex="0" role="button"></i>`}
            </div>
        </div>
    `;
}
/**
 * Refreshes specific parts of the task UI without a full re-render.
 */
export function refreshTaskUI(nodeId) {
    const card = document.querySelector(`.polyceph-node-card[data-node-id="${nodeId}"]`);
    if (!card) return;

    const activePipeline = getActivePipeline();
    let task = null;
    let stepId = null;

    for (const step of activePipeline.steps) {
        task = step.tasks.find(n => n.id === nodeId);
        if (task) {
            stepId = step.id;
            break;
        }
    }
    if (!task) return;

    const profileId = task.profile || 'none';
    const profile = availableProfiles.find(p => p.id === profileId);
    const apiId = profileId === 'none' ? 'none' : (profile?.api || SillyTavern.getContext().mainApi || '');
    const isCC = profileId !== 'none' && isChatCompletionApi(apiId);
    const isLocked = !!activePipeline.isLocked;
    const disabled = isLocked ? 'disabled' : '';

    // 1. Update Preset Select
    const presetSelect = card.querySelector('.polyceph-preset-select');
    if (presetSelect) {
        presetSelect.innerHTML = getPresetOptionsHTML(task.profile, task.preset);
    }

    // 2. Update Task Type Select (to show/hide Tool Processor)
    const typeSelect = card.querySelector('.polyceph-node-output-type');
    if (typeSelect) {
        const currentVal = typeSelect.value;
        typeSelect.innerHTML = `
            <option value="character" ${currentVal === 'character' ? 'selected' : ''}>Character Message</option>
            <option value="thinking" ${currentVal === 'thinking' ? 'selected' : ''}>Reasoning</option>
            ${isCC ? `<option value="tool" ${currentVal === 'tool' ? 'selected' : ''}>Tool Processor</option>` : ''}
            ${isCC ? `<option value="mcp" ${currentVal === 'mcp' ? 'selected' : ''}>MCP</option>` : ''}
            <option value="internal" ${currentVal === 'internal' ? 'selected' : ''}>Internal (Hidden)</option>
        `;
    }

    // 3. Update Options Bar
    let optionsBar = card.querySelector('.polyceph-task-options-bar');
    const newOptionsBarHtml = renderTaskOptionsBar(task, apiId, disabled);

    if (optionsBar) {
        if (newOptionsBarHtml) {
            // Replace existing bar
            const temp = document.createElement('div');
            temp.innerHTML = newOptionsBarHtml;
            const newBar = temp.firstElementChild;
            optionsBar.replaceWith(newBar);
        } else {
            // Remove existing bar
            optionsBar.remove();
        }
    } else if (newOptionsBarHtml) {
        // Add new bar after the task type select container
        const header = card.querySelector('.polyceph-node-header');
        if (header) {
            header.insertAdjacentHTML('beforeend', newOptionsBarHtml);
        }
    }
}
