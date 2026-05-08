import { getActivePipeline, saveSettings } from '../../../state.js';
import { generateId, autoResizeTextarea } from '../../../utils.js';
import { getEl, SELECTORS } from '../../ui-shared.js';
import { activeStepIndex, setActiveStepIndex, Popup } from './state.js';
import { updatePipelineEditorUI } from './pipeline-editor.js';

/**
 * Binds event listeners to the step and task elements.
 */
export function bindStepEvents() {
    const container = getEl(SELECTORS.SETTINGS_CONTAINER);
    if (!container) return;

    const activePipeline = getActivePipeline();

    // --- Step Management Bar ---
    const addStepBtn = getEl('polyceph_add_step_btn');
    if (addStepBtn && !addStepBtn.dataset.bound) {
        addStepBtn.dataset.bound = 'true';
        addStepBtn.addEventListener('click', () => {
            if (activePipeline.isLocked) return;
            activePipeline.steps.push({
                id: 'step_' + generateId(),
                tasks: []
            });
            setActiveStepIndex(activePipeline.steps.length - 1);
            saveSettings();
            updatePipelineEditorUI();
        });
    }

    const duplicateStepBtn = getEl('polyceph_duplicate_step_btn');
    if (duplicateStepBtn && !duplicateStepBtn.dataset.bound) {
        duplicateStepBtn.dataset.bound = 'true';
        duplicateStepBtn.addEventListener('click', () => {
            if (activePipeline.isLocked) return;
            const stepToDup = activePipeline.steps[activeStepIndex];
            if (!stepToDup) return;

            // Deep clone step and tasks
            const newStep = JSON.parse(JSON.stringify(stepToDup));
            newStep.id = 'step_' + generateId();
            newStep.label = newStep.label ? `${newStep.label} (Copy)` : `Step ${activeStepIndex + 1} (Copy)`;
            newStep.tasks.forEach(task => {
                task.id = 'task_' + generateId();
            });

            activePipeline.steps.splice(activeStepIndex + 1, 0, newStep);
            setActiveStepIndex(activeStepIndex + 1);
            saveSettings();
            updatePipelineEditorUI();
        });
    }

    const moveLeftStepBtn = getEl('polyceph_move_left_step_btn');
    if (moveLeftStepBtn && !moveLeftStepBtn.dataset.bound) {
        moveLeftStepBtn.dataset.bound = 'true';
        moveLeftStepBtn.addEventListener('click', () => {
            if (activePipeline.isLocked || activeStepIndex <= 0) return;
            const steps = activePipeline.steps;
            [steps[activeStepIndex - 1], steps[activeStepIndex]] = [steps[activeStepIndex], steps[activeStepIndex - 1]];
            setActiveStepIndex(activeStepIndex - 1);
            saveSettings();
            updatePipelineEditorUI();
        });
    }

    const moveRightStepBtn = getEl('polyceph_move_right_step_btn');
    if (moveRightStepBtn && !moveRightStepBtn.dataset.bound) {
        moveRightStepBtn.dataset.bound = 'true';
        moveRightStepBtn.addEventListener('click', () => {
            if (activePipeline.isLocked || activeStepIndex >= activePipeline.steps.length - 1) return;
            const steps = activePipeline.steps;
            [steps[activeStepIndex + 1], steps[activeStepIndex]] = [steps[activeStepIndex], steps[activeStepIndex + 1]];
            setActiveStepIndex(activeStepIndex + 1);
            saveSettings();
            updatePipelineEditorUI();
        });
    }

    const delStepBtn = getEl('polyceph_del_step_btn');
    if (delStepBtn && !delStepBtn.dataset.bound) {
        delStepBtn.dataset.bound = 'true';
        delStepBtn.addEventListener('click', async () => {
            if (activePipeline.isLocked || activePipeline.steps.length === 0) return;
            const step = activePipeline.steps[activeStepIndex];
            
            const confirmed = !Popup || await Popup.show.confirm(
                'Delete Step',
                `Are you sure you want to delete step ${activeStepIndex + 1} ("${step.label || 'unnamed'}")?<br>This will delete all tasks within this step.`
            );
            if (!confirmed) return;

            activePipeline.steps.splice(activeStepIndex, 1);
            setActiveStepIndex(Math.max(0, activeStepIndex - 1));
            saveSettings();
            updatePipelineEditorUI();
        });
    }

    // Node profile select
    container.querySelectorAll('.polyceph-profile-select').forEach(select => {
        if (select.dataset.bound) return;
        select.dataset.bound = 'true';
        select.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) {
                    task.profile = e.target.value;
                    break;
                }
            }
            saveSettings();
            updatePipelineEditorUI();
        });
    });

    // Node preset select
    container.querySelectorAll('.polyceph-preset-select').forEach(select => {
        if (select.dataset.bound) return;
        select.dataset.bound = 'true';
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
        if (textarea.dataset.bound) return;
        textarea.dataset.bound = 'true';
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
        if (btn.dataset.bound) return;
        btn.dataset.bound = 'true';
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
        if (btn.dataset.bound) return;
        btn.dataset.bound = 'true';
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
        if (input.dataset.bound) return;
        input.dataset.bound = 'true';
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
        if (input.dataset.bound) return;
        input.dataset.bound = 'true';
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
        if (select.dataset.bound) return;
        select.dataset.bound = 'true';
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
        if (cb.dataset.bound) return;
        cb.dataset.bound = 'true';
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
        if (cb.dataset.bound) return;
        cb.dataset.bound = 'true';
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
        if (cb.dataset.bound) return;
        cb.dataset.bound = 'true';
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
        if (cb.dataset.bound) return;
        cb.dataset.bound = 'true';
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
        if (cb.dataset.bound) return;
        cb.dataset.bound = 'true';
        cb.addEventListener('change', (e) => {
            const nodeId = e.target.getAttribute('data-node-id');
            for (const step of activePipeline.steps) {
                const task = step.tasks.find(n => n.id === nodeId);
                if (task) { task.hideToolHistory = e.target.checked; break; }
            }
            saveSettings();
        });
    });
}
