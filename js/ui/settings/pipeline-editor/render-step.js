import { renderTask } from './render-task.js';

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
            </div>

            <div>
                <div style="height: 1px; background: var(--black30a); width: 100%; margin-bottom: 5px;"></div>
                <small style="color: var(--SmartThemeQuoteColor); font-weight: bold; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8;">Tasks (Parallel)</small>
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
