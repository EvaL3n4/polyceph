import { settings, saveSettings, getActivePipeline } from '../../../state.js';
import { autoResizeTextarea } from '../../../utils.js';
import { SELECTORS, getEl } from '../../ui-shared.js';
import { createPromptEditor } from '../prompt-editor.js';
import { activeStepIndex, setActiveStepIndex, lastPipelineId, setLastPipelineId } from './state.js';
import { renderTab, bindTabScrollEvents } from './render-tab.js';
import { renderStep } from './render-step.js';
import { renderTask } from './render-task.js';
import { bindStepEvents } from './events.js';

export { activeStepIndex, setActiveStepIndex, bindStepEvents, renderTask, renderStep };

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
            setActiveStepIndex(0);
            setLastPipelineId(activePipeline.id);
        }

        // Ensure active index is within bounds
        if (activeStepIndex >= activePipeline.steps.length) {
            setActiveStepIndex(Math.max(0, activePipeline.steps.length - 1));
        }

        // Render Tabs
        const tabContainer = getEl('polyceph_step_tabs_container');
        if (tabContainer) {
            tabContainer.innerHTML = activePipeline.steps.map((s, i) => renderTab(s, i, i === activeStepIndex)).join('');
            bindTabScrollEvents(tabContainer);

            // Bind click to tabs
            tabContainer.querySelectorAll('.polyceph-step-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    setActiveStepIndex(parseInt(tab.getAttribute('data-index')));
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

    // Update step management buttons
    const addStepBtn = getEl('polyceph_add_step_btn');
    const duplicateStepBtn = getEl('polyceph_duplicate_step_btn');
    const moveLeftStepBtn = getEl('polyceph_move_left_step_btn');
    const moveRightStepBtn = getEl('polyceph_move_right_step_btn');
    const delStepBtn = getEl('polyceph_del_step_btn');

    if (addStepBtn) {
        addStepBtn.style.opacity = isLocked ? '0.3' : '1';
        addStepBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';
    }
    if (duplicateStepBtn) {
        duplicateStepBtn.style.opacity = isLocked ? '0.3' : '1';
        duplicateStepBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';
    }
    if (moveLeftStepBtn) {
        const canMoveLeft = !isLocked && activeStepIndex > 0;
        moveLeftStepBtn.style.opacity = canMoveLeft ? '1' : '0.3';
        moveLeftStepBtn.style.cursor = canMoveLeft ? 'pointer' : 'not-allowed';
    }
    if (moveRightStepBtn) {
        const canMoveRight = !isLocked && activeStepIndex < activePipeline.steps.length - 1;
        moveRightStepBtn.style.opacity = canMoveRight ? '1' : '0.3';
        moveRightStepBtn.style.cursor = canMoveRight ? 'pointer' : 'not-allowed';
    }
    if (delStepBtn) {
        const canDel = !isLocked && activePipeline.steps.length > 0;
        delStepBtn.style.opacity = canDel ? '1' : '0.3';
        delStepBtn.style.cursor = canDel ? 'pointer' : 'not-allowed';
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
