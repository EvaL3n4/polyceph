import { availableProfiles, availablePresetsByApi, settings, saveSettings, getActivePipeline } from '../../state.js';
import { autoResizeTextarea, generateId } from '../../utils.js';
import { logger } from '../../logger.js';
import { SELECTORS, getEl } from '../ui-shared.js';

/**
 * Generates HTML for the preset dropdown based on the selected profile's API.
 */
function getPresetOptionsHTML(profileId, currentPreset) {
    const profile = availableProfiles.find(p => p.id === profileId);
    let apiId = profile?.api;
    let fallbackReason = '';

    if (!apiId) {
        apiId = SillyTavern.getContext().mainApi || '';
        fallbackReason = profile ? `Profile "${profile.name}" has no API defined.` : `Profile ID "${profileId}" not found.`;
        logger.warn(`Using fallback API "${apiId}" for preset dropdown. Reason: ${fallbackReason}`);
    }

    const presets = availablePresetsByApi[apiId] || [];
    
    return `<option value="Current" ${(!currentPreset || currentPreset === 'Current') ? 'selected' : ''}>Current Preset</option>` +
        presets.map(p => `<option value="${p}" ${p === currentPreset ? 'selected' : ''}>${p}</option>`).join('');
}

/**
 * Renders the HTML for a single task node.
 */
export function renderTask(stepId, task) {
    const profileOptions = `<option value="none">(Template Only - No LLM)</option>` +
        availableProfiles.map(p => `<option value="${p.id}" ${p.id === task.profile ? 'selected' : ''}>${p.name}</option>`).join('');

    const presetOptions = getPresetOptionsHTML(task.profile, task.preset);

    return `
        <div class="polyceph-node-card" data-node-id="${task.id}">
            <div class="polyceph-node-header" style="display: flex; flex-direction: column; gap: 8px;">
                <div class="polyceph-node-header-label-row">
                    <input type="text" class="polyceph-node-label-input text_pole" data-node-id="${task.id}" placeholder="Task Label..." value="${task.label || ''}" style="flex: 1; min-width: 100px; padding: 2px 5px;" />
                    <i class="fa-solid fa-times polyceph-del-node" data-node-id="${task.id}" data-step-id="${stepId}"></i>
                </div>
                <div class="polyceph-node-header-controls">
                    <select class="polyceph-profile-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;">
                        ${profileOptions}
                    </select>
                    <select class="polyceph-preset-select text_pole" data-node-id="${task.id}" style="flex: 1; min-width: 150px;" title="Override the API preset for this task">
                        ${presetOptions}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 15px; padding-left: 2px; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-persist-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.persist ? 'checked' : ''} title="Display this task result as Thinking">
                        <label style="font-size: 0.8em; cursor: pointer;" title="Display this task result as Thinking">Thinking</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-character-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.isCharacter ? 'checked' : ''} title="If persisted, use character name/avatar">
                        <label style="font-size: 0.8em; cursor: pointer;" title="If persisted, use character name/avatar">Character Message</label>
                    </div>
                </div>
            </div>
            <textarea class="polyceph-node-template text_pole" data-step="${stepId}" data-node="${task.id}" placeholder="Use {{user_input}} or {{chat_history:2}}...">${task.template || ''}</textarea>
        </div>
    `;
}

/**
 * Renders the HTML for a single pipeline step.
 */
export function renderStep(step, index) {
    const tasksHtml = step.tasks.map(n => renderTask(step.id, n)).join('');

    return `
        <div class="polyceph-step-card" data-step-id="${step.id}">
            <div class="polyceph-step-header" style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <b>Step ${index + 1} </b>
                    <input type="text" class="polyceph-step-label-input text_pole" data-step-id="${step.id}" placeholder="Custom Label..." value="${step.label || ''}" style="flex: 1; max-width: 200px; padding: 2px 5px;" />
                    <i class="fa-solid fa-trash polyceph-del-step" data-step-id="${step.id}" style="margin-left: auto;"></i>
                </div>
            </div>
            <div class="polyceph-nodes-list">
                ${tasksHtml}
            </div>
            <button class="menu_button polyceph-add-node-btn" data-step="${step.id}">
                <i class="fa-solid fa-plus"></i> Add Profile Task
            </button>
        </div>
    `;
}

/**
 * Updates the entire pipeline editor UI.
 */
export function updatePipelineEditorUI() {
    const activePipeline = getActivePipeline();
    const stepsContainer = getEl(SELECTORS.STEPS_CONTAINER);
    if (stepsContainer) {
        stepsContainer.innerHTML = activePipeline.steps.map((s, i) => renderStep(s, i)).join('');

        // Auto-resize all textareas after render
        setTimeout(() => {
            stepsContainer.querySelectorAll('textarea').forEach(textarea => {
                autoResizeTextarea(textarea);
            });
        }, 150);

        bindStepEvents();
    }

    // Update pipeline selector
    const selector = getEl(SELECTORS.SETTINGS_SELECTOR);
    if (selector) {
        const noneSelected = settings.activePipelineId === 'none' ? 'selected' : '';
        selector.innerHTML = `<option value="none" ${noneSelected}>None (Disabled)</option>` +
            settings.pipelines.map(p =>
                `<option value="${p.id}" ${p.id === settings.activePipelineId ? 'selected' : ''}>${p.name}</option>`
            ).join('');
    }

    // Update active pipeline name input
    const nameInput = getEl(SELECTORS.NAME_INPUT);
    if (nameInput) {
        nameInput.value = activePipeline.name;
    }
}

/**
 * Binds event listeners to the step and task elements.
 */
export function bindStepEvents() {
    const container = getEl(SELECTORS.SETTINGS_CONTAINER);
    if (!container) return;

    const activePipeline = getActivePipeline();

    // Node profile select
    container.querySelectorAll('.polyceph-profile-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            let updatedTask = null;
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) {
                    task.profile = e.target.value;
                    updatedTask = task;
                    break;
                }
            }
            saveSettings();

            // Dynamic preset list update
            if (updatedTask) {
                const card = e.target.closest('.polyceph-node-card');
                const presetSelect = card?.querySelector('.polyceph-preset-select');
                if (presetSelect) {
                    presetSelect.innerHTML = getPresetOptionsHTML(updatedTask.profile, updatedTask.preset);
                }
            }
        });
    });

    // Node preset select
    container.querySelectorAll('.polyceph-preset-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.preset = e.target.value; break; }
            }
            saveSettings();
        });
    });

    // Node template textarea
    container.querySelectorAll('.polyceph-node-template').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            const stepId = e.target.getAttribute('data-step');
            const nodeId = e.target.getAttribute('data-node');
            const step = activePipeline.steps.find(s => s.id === stepId);
            const task = step?.tasks.find(n => n.id === nodeId);
            if (task) {
                task.template = e.target.value;
                saveSettings();
            }
        });
    });

    // Remove Node
    container.querySelectorAll('.polyceph-del-node').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const nodeId = e.currentTarget.getAttribute('data-node-id');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) {
                step.tasks = step.tasks.filter(n => n.id !== nodeId);
                saveSettings();
                updatePipelineEditorUI();
            }
        });
    });

    // Add Node
    container.querySelectorAll('.polyceph-add-node-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) {
                step.tasks.push({ id: 'task_' + generateId(), profile: '', preset: 'Current', template: '{{user_input}}' });
                saveSettings();
                updatePipelineEditorUI();
            }
        });
    });

    // Label inputs
    container.querySelectorAll('.polyceph-node-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.label = e.target.value; break; }
            }
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-step-label-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const stepId = e.target.getAttribute('data-step-id');
            const step = activePipeline.steps.find(s => s.id === stepId);
            if (step) step.label = e.target.value;
            saveSettings();
        });
    });

    // Checkboxes
    container.querySelectorAll('.polyceph-node-persist-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.persist = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-node-character-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.isCharacter = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    // Remove Step
    container.querySelectorAll('.polyceph-del-step').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const idx = activePipeline.steps.findIndex(s => s.id === stepId);
            if (idx !== -1) {
                activePipeline.steps.splice(idx, 1);
                saveSettings();
                updatePipelineEditorUI();
            }
        });
    });
}
