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
 * Renders the HTML for a single task node.
 */
export function renderTask(stepId, task, isLocked = false) {
    const profileFound = task.profile === 'none' || availableProfiles.some(p => p.id === task.profile);
    let profileOptions = `<option value="none" ${task.profile === 'none' ? 'selected' : ''}>(Template Only - No LLM)</option>`;

    if (!profileFound && task.profile) {
        profileOptions += `<option value="${task.profile}" selected style="color: var(--red); font-weight: bold;">⚠️ ${task.profile} (Missing Profile)</option>`;
    }

    profileOptions += availableProfiles.map(p => `<option value="${p.id}" ${p.id === task.profile ? 'selected' : ''}>${p.name}</option>`).join('');

    const presetOptions = getPresetOptionsHTML(task.profile, task.preset);
    const disabled = isLocked ? 'disabled' : '';

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
                        <input type="checkbox" class="polyceph-node-persist-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.persist ? 'checked' : ''} title="Display this task result as Thinking" ${disabled}>
                        <label style="font-size: 0.8em; cursor: pointer;" title="Display this task result as Thinking">Thinking</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-character-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.isCharacter ? 'checked' : ''} title="If persisted, use character name/avatar" ${disabled}>
                        <label style="font-size: 0.8em; cursor: pointer;" title="If persisted, use character name/avatar">Character Message</label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" class="polyceph-node-antiloop-checkbox" data-step-id="${stepId}" data-node-id="${task.id}" ${task.antiLoop !== false ? 'checked' : ''} title="Abort generation if the model starts looping" ${disabled}>
                        <label style="font-size: 0.8em; cursor: pointer;" title="Abort generation if the model starts looping">Anti-Loop</label>
                    </div>
                </div>
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
