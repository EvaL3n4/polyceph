import { availableProfiles, availablePresetsByApi, settings, saveSettings, getActivePipeline } from '../../state.js';
import { isChatCompletionApi } from '../../compat-chat.js';
import { getPresetSettings } from '../../compat-presets.js';
import { autoResizeTextarea, generateId } from '../../utils.js';
import { logger } from '../../logger.js';
import { SELECTORS, getEl, CLASSES } from '../ui-shared.js';
import { getPopupModule } from '../../compat-st.js';
import { createPromptEditor } from './prompt-editor.js';

let Popup = null;
(async () => {
    const popupModule = await getPopupModule();
    if (popupModule) Popup = popupModule.Popup;
})();

export let activeStepIndex = 0;
let lastPipelineId = null;

export function setActiveStepIndex(index) {

    activeStepIndex = index;
}

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

    // Resolve which settings to check for function calling
    const presetName = task.preset || 'Current';
    const presetSettings = (presetName === 'Current')
        ? SillyTavern.getContext().chatCompletionSettings
        : getPresetSettings(presetName, apiId);

    const isFunctionCallingDisabled = presetSettings?.function_calling === false;
    let html = '';

    if (task.outputType === 'tool' && isCC) {
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
                <div class="polyceph-node-option" style="display: flex; align-items: center; gap: 4px; color: #ff4d4d; font-weight: bold;" title="Function calling is disabled in the selected preset for this task. This task will fail to execute tools.">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span style="font-size: 0.8em;">Function Calling Disabled</span>
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
 * Renders the HTML for a single pipeline step.
 */
export function renderStep(step, index, isLocked = false) {
    const tasksHtml = step.tasks.map(n => renderTask(step.id, n, isLocked)).join('');

    return `
        <div class="polyceph-step-card ${isLocked ? 'polyceph-locked' : ''}" data-step-id="${step.id}">
            <div class="polyceph-step-header" style="display: flex; align-items: center; gap: 10px; width: 100%; border-bottom: none; padding-bottom: 0;">
                <b>Step ${index + 1} </b>
                <input type="text" class="polyceph-step-label-input text_pole" data-step-id="${step.id}" placeholder="Custom Label..." value="${step.label || ''}" style="flex: 1; padding: 2px 5px;" ${isLocked ? 'disabled' : ''} />
                ${isLocked ? '' : `<i class="fa-solid fa-trash polyceph-del-step" data-step-id="${step.id}" style="margin-left: auto; cursor: pointer; color: #ff4d4d;" title="Delete Step"></i>`}
            </div>

            <div>
                <div style="height: 1px; background: var(--black30a); width: 100%; margin-bottom: 5px;"></div>
                <small style="color: var(--SmartThemeQuoteColor); font-weight: bold; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8;">Tasks</small>
            </div>

            <div class="polyceph-nodes-list">
                ${tasksHtml}
            </div>
            ${isLocked ? '' : `
            <button class="menu_button polyceph-add-node-btn" data-step="${step.id}">
                <i class="fa-solid fa-plus"></i> Add Task (Parallel) to Step 
            </button>
            `}
        </div>
    `;
}

/**
 * Renders the HTML for a single tab.
 */
function renderTab(step, index, isActive) {
    const label = step.label || `Step ${index + 1}`;
    return `
        <div class="polyceph-step-tab ${isActive ? 'active' : ''}" data-index="${index}" title="${label}">
            <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</span>
        </div>
    `;
}

/**
 * Attaches drag-to-scroll and mousewheel events to the tab bar.
 */
function bindTabScrollEvents(tabContainer) {
    if (!tabContainer) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    tabContainer.addEventListener('mousedown', (e) => {
        isDown = true;
        tabContainer.classList.add('active');
        startX = e.pageX - tabContainer.offsetLeft;
        scrollLeft = tabContainer.scrollLeft;
    });

    tabContainer.addEventListener('mouseleave', () => {
        isDown = false;
    });

    tabContainer.addEventListener('mouseup', () => {
        isDown = false;
    });

    tabContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - tabContainer.offsetLeft;
        const walk = (x - startX) * 2; // Scroll speed
        tabContainer.scrollLeft = scrollLeft - walk;
    });

    tabContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            tabContainer.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}

/**
 * Updates the entire pipeline editor UI.
 */
export function updatePipelineEditorUI() {
    const activePipeline = getActivePipeline();
    const isLocked = !!activePipeline.isLocked;
    const stepsContainer = getEl(SELECTORS.STEPS_CONTAINER);

    if (stepsContainer) {

        // Reset active index if pipeline changed
        if (lastPipelineId !== activePipeline.id) {
            activeStepIndex = 0;
            lastPipelineId = activePipeline.id;
        }

        // Ensure active index is within bounds
        if (activeStepIndex >= activePipeline.steps.length) {
            activeStepIndex = Math.max(0, activePipeline.steps.length - 1);
        }

        // Render Tabs
        const tabContainer = getEl('polyceph_step_tabs_container');
        if (tabContainer) {
            tabContainer.innerHTML = activePipeline.steps.map((s, i) => renderTab(s, i, i === activeStepIndex)).join('');
            bindTabScrollEvents(tabContainer);

            // Bind click to tabs
            tabContainer.querySelectorAll('.polyceph-step-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    activeStepIndex = parseInt(tab.getAttribute('data-index'));
                    updatePipelineEditorUI();
                });
            });

            // Scroll active tab into view
            const activeTab = tabContainer.querySelector('.polyceph-step-tab.active');
            if (activeTab) {
                activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }

        // Render Steps
        stepsContainer.innerHTML = activePipeline.steps.map((s, i) => {
            const html = renderStep(s, i, isLocked);
            // Add active class if it's the current step
            if (i === activeStepIndex) {
                return html.replace('polyceph-step-card', 'polyceph-step-card active');
            }
            return html;
        }).join('');

        // Auto-resize and initialize CodeMirror for all textareas after render
        setTimeout(() => {
            // Collect all task and step labels for highlighting
            const allLabels = [];
            activePipeline.steps.forEach(step => {
                if (step.label) allLabels.push(step.label.trim());
                step.tasks.forEach(task => {
                    if (task.label) allLabels.push(task.label.trim());
                });
            });

            stepsContainer.querySelectorAll('.active textarea.polyceph-node-template').forEach(textarea => {
                const stepId = textarea.getAttribute('data-step');
                const nodeId = textarea.getAttribute('data-node');
                createPromptEditor(textarea, (val) => {
                    const step = activePipeline.steps.find(s => s.id === stepId);
                    const task = step?.tasks.find(n => n.id === nodeId);
                    if (task) {
                        task.template = val;
                        saveSettings();
                    }
                }, allLabels);
            });
            stepsContainer.querySelectorAll('.active textarea:not(.polyceph-node-template)').forEach(textarea => {
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
        btn.addEventListener('click', async (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const nodeId = e.currentTarget.getAttribute('data-node-id');
            const step = activePipeline.steps.find(s => s.id === stepId);
            const task = step?.tasks.find(n => n.id === nodeId);

            if (step && task) {
                const confirmed = !Popup || await Popup.show.confirm(
                    'Delete Task',
                    `Are you sure you want to delete the task "${task.label || 'unnamed'}"?<br>This cannot be undone.`
                );
                if (!confirmed) return;

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
                    profile: 'current',
                    preset: 'Current',
                    template: '{{user_input}}',
                    outputType: 'character',
                    persist: true,
                    isCharacter: true,
                    stripThink: true,
                    antiLoop: true,
                    allowTools: false,
                    hideSuccessResponse: false,
                    skipSuccessRecursion: false,
                    hideToolHistory: false,
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

            // Update tab text directly for performance
            const tabContainer = getEl('polyceph_step_tabs_container');
            const tab = tabContainer?.querySelector(`.polyceph-step-tab[data-index="${activeStepIndex}"] span`);
            if (tab) {
                tab.textContent = e.target.value || `Step ${activeStepIndex + 1}`;
            }

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
    container.querySelectorAll('.polyceph-node-hide-tool-history-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.hideToolHistory = e.target.checked; break; }
            }
            saveSettings();
        });
    });
    // Remove Step
    container.querySelectorAll('.polyceph-del-step').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const stepId = e.currentTarget.getAttribute('data-step-id');
            const idx = activePipeline.steps.findIndex(s => s.id === stepId);
            const step = activePipeline.steps[idx];

            if (idx !== -1 && step) {
                const confirmed = !Popup || await Popup.show.confirm(
                    'Delete Step',
                    `Are you sure you want to delete step ${idx + 1} ("${step.label || 'unnamed'}")?<br>This will delete all tasks within this step.`
                );
                if (!confirmed) return;

                activePipeline.steps.splice(idx, 1);
                saveSettings();
                updatePipelineEditorUI();
            }
        });
    });

}
