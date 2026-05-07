import { availableProfiles, availablePresetsByApi, settings, saveSettings, getActivePipeline } from '../../state.js';
import { isChatCompletionApi } from '../../compat-chat.js';
import { autoResizeTextarea, generateId } from '../../utils.js';
import { logger } from '../../logger.js';
import { SELECTORS, getEl } from '../ui-shared.js';

/**
 * Generates HTML for the preset dropdown based on the selected profile's API.
 */
function getPresetOptionsHTML(profileId, currentPreset) {
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
function renderTaskOptionsBar(task, apiId, disabled) {
    if (!apiId || apiId === 'none') return '';

    const isCC = isChatCompletionApi(apiId);
    let html = '';

    if ((task.outputType === 'thinking' || task.outputType === 'character') && isCC) {
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
    } else if (task.outputType === 'tool' && isCC) {
        html = `
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-skip-recursion-checkbox" data-node-id="${task.id}" ${task.skipSuccessRecursion ? 'checked' : ''} title="If checked, the task will end immediately after successful tool calls, skipping the model's final response." ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">No Success Recursion</label>
            </div>
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-hide-success-checkbox" data-node-id="${task.id}" ${task.hideSuccessResponse ? 'checked' : ''} title="If checked, this task will return an empty string regardless of LLM output. Useful for background tool processors." ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Hide Success Response</label>
            </div>
        `;
    } else if (isCC) {
        // Fallback for CC tasks that are internal
        html = `
            <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" class="polyceph-node-antiloop-checkbox" data-node-id="${task.id}" ${task.antiLoop !== false ? 'checked' : ''} title="Abort generation if the model starts looping" ${disabled}>
                <label style="font-size: 0.8em; cursor: pointer;">Anti-Loop</label>
            </div>
        `;
    }

    if (!html) return '';

    return `
        <div class="polyceph-task-options-bar" data-node-id="${task.id}" style="display: flex; align-items: center; gap: 15px; padding: 4px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; margin-top: 4px;">
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
                    ${isLocked ? '' : `<i class="fa-solid fa-times polyceph-del-node" data-node-id="${task.id}" data-step-id="${stepId}"></i>`}
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
                            <option value="internal" ${task.outputType === 'internal' ? 'selected' : ''}>Internal (Hidden)</option>
                            <option value="thinking" ${task.outputType === 'thinking' ? 'selected' : ''}>Reasoning</option>
                            <option value="character" ${task.outputType === 'character' ? 'selected' : ''}>Character Message</option>
                            ${isCC ? `<option value="tool" ${task.outputType === 'tool' ? 'selected' : ''}>Tool Processor</option>` : ''}
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
 * Renders the HTML for a single pipeline step.
 */
export function renderStep(step, index, isLocked = false) {
    const tasksHtml = step.tasks.map(n => renderTask(step.id, n, isLocked)).join('');

    return `
        <div class="polyceph-step-card ${isLocked ? 'polyceph-locked' : ''}" data-step-id="${step.id}">
            <div class="polyceph-step-header" style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <b>Step ${index + 1} </b>
                    <input type="text" class="polyceph-step-label-input text_pole" data-step-id="${step.id}" placeholder="Custom Label..." value="${step.label || ''}" style="flex: 1; max-width: 200px; padding: 2px 5px;" ${isLocked ? 'disabled' : ''} />
                    ${isLocked ? '' : `<i class="fa-solid fa-trash polyceph-del-step" data-step-id="${step.id}" style="margin-left: auto;"></i>`}
                </div>
            </div>
            <div class="polyceph-nodes-list">
                ${tasksHtml}
            </div>
            ${isLocked ? '' : `
            <button class="menu_button polyceph-add-node-btn" data-step="${step.id}">
                <i class="fa-solid fa-plus"></i> Add Profile Task
            </button>
            `}
        </div>
    `;
}

/**
 * Updates the entire pipeline editor UI.
 */
export function updatePipelineEditorUI() {
    const activePipeline = getActivePipeline();
    const isLocked = !!activePipeline.isLocked;
    const stepsContainer = getEl(SELECTORS.STEPS_CONTAINER);

    if (stepsContainer) {
        stepsContainer.innerHTML = activePipeline.steps.map((s, i) => renderStep(s, i, isLocked)).join('');

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
                `<option value="${p.id}" ${p.id === settings.activePipelineId ? 'selected' : ''}>${p.name}${p.isLocked ? ' 🔒' : ''}</option>`
            ).join('');
    }

    // Update active pipeline name input and lock state
    const nameInput = getEl(SELECTORS.NAME_INPUT);
    if (nameInput) {
        nameInput.value = activePipeline.name;
        nameInput.disabled = isLocked;
    }

    // Update main action buttons
    const addStepBtn = getEl('polyceph_add_step_btn');
    if (addStepBtn) {
        addStepBtn.style.display = isLocked ? 'none' : 'block';
    }

    // Update lock button icon and pipeline action states
    const lockBtn = getEl('polyceph_lock_pipeline_btn');
    const delBtn = getEl('polyceph_del_pipeline_btn');
    const newBtn = getEl('polyceph_new_pipeline_btn');
    const duplicateBtn = getEl('polyceph_duplicate_pipeline_btn');

    if (lockBtn) {
        lockBtn.className = isLocked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open';
        lockBtn.title = isLocked ? 'Unlock Pipeline Editing' : 'Lock Pipeline Editing';
    }

    if (delBtn) {
        delBtn.style.opacity = isLocked ? '0.3' : '1';
        delBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';
        delBtn.title = isLocked ? 'Pipeline is locked' : 'Delete Current Pipeline';
    }

    if (newBtn) {
        newBtn.style.opacity = '1';
        newBtn.style.cursor = 'pointer';
    }

    if (duplicateBtn) {
        duplicateBtn.style.opacity = '1';
        duplicateBtn.style.cursor = 'pointer';
    }

    // Reordering buttons

    const upBtn = getEl('polyceph_move_up_pipeline_btn');
    const downBtn = getEl('polyceph_move_down_pipeline_btn');
    const pipelineIndex = settings.pipelines.findIndex(p => p.id === settings.activePipelineId);

    if (upBtn) {
        const canMoveUp = !isLocked && pipelineIndex > 0;
        upBtn.style.opacity = canMoveUp ? '1' : '0.3';
        upBtn.style.cursor = canMoveUp ? 'pointer' : 'not-allowed';
        upBtn.title = isLocked ? 'Pipeline is locked' : (canMoveUp ? 'Move Up in List' : 'Already at the top');
    }

    if (downBtn) {
        const canMoveDown = !isLocked && pipelineIndex !== -1 && pipelineIndex < settings.pipelines.length - 1;
        downBtn.style.opacity = canMoveDown ? '1' : '0.3';
        downBtn.style.cursor = canMoveDown ? 'pointer' : 'not-allowed';
        downBtn.title = isLocked ? 'Pipeline is locked' : (canMoveDown ? 'Move Down in List' : 'Already at the bottom');
    }

    // Coming soon icons
    getEl(SELECTORS.SETTINGS_CONTAINER)?.querySelectorAll('.polyceph-coming-soon').forEach(icon => {
        icon.style.opacity = '0.4';
    });
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
            updatePipelineEditorUI();
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
                step.tasks.push({
                    id: 'task_' + generateId(),
                    profile: 'none',
                    preset: 'Current',
                    template: '{{user_input}}',
                    outputType: 'internal',
                    persist: false,
                    isCharacter: false,
                    stripThink: true,
                    antiLoop: true,
                    allowTools: false,
                    hideSuccessResponse: false,
                    skipSuccessRecursion: false,
                    streaming: true
                });
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

    // Output Type Select
    container.querySelectorAll('.polyceph-node-output-type').forEach(select => {
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            const val = e.target.value;
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) {
                    task.outputType = val;
                    // Keep legacy flags in sync for engine compatibility
                    task.persist = (val === 'thinking' || val === 'character');
                    task.isCharacter = (val === 'character');
                    task.allowTools = (val === 'tool'); // Tools only enabled for Tool Processor mode
                    break;
                }
            }
            saveSettings();
            updatePipelineEditorUI();
        });
    });

    // Options Bar Checkboxes
    container.querySelectorAll('.polyceph-node-streaming-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.streaming = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-node-antiloop-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.antiLoop = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-node-skip-recursion-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.skipSuccessRecursion = e.target.checked; break; }
            }
            saveSettings();
        });
    });

    container.querySelectorAll('.polyceph-node-hide-success-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.hideSuccessResponse = e.target.checked; break; }
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
