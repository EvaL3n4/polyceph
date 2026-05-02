import { getActivePipeline, settings } from '../../state.js';
import { expandPrompt } from '../../macros/macros.js';
import { logger } from '../../logger.js';
import { countTokens, getMaxContextTokens, getMaxResponseTokens } from '../../compat-shared.js';

/**
 * Generates and displays a modal with the assembled prompts for each task in the active pipeline.
 */
export async function showPromptPreview() {
    const pipeline = getActivePipeline();
    const stContext = SillyTavern.getContext();

    // Use the current chat state, excluding typing indicators and system commands
    const cleanChat = stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/'));

    // 1. Prepare contextVault with placeholders for task/step outputs
    const contextVault = {};
    pipeline.steps.forEach((step, sIdx) => {
        const stepIdx = sIdx + 1;

        step.tasks.forEach((task, tIdx) => {
            const taskIdIndx = tIdx + 1;
            const label = task.label ? task.label.trim() : `Task ${taskIdIndx}`;
            const placeholder = `(Output of Task: \{\{${label}\}\})`;

            // Map all standard keys used by the orchestrator
            contextVault[`${step.id}_task_${taskIdIndx}`] = placeholder;
            contextVault[`${step.id}_target_${taskIdIndx}`] = placeholder;
            contextVault[`s${stepIdx}k${taskIdIndx}`] = placeholder;
            contextVault[`s${stepIdx}t${taskIdIndx}`] = placeholder;
            if (task.label) contextVault[task.label.trim()] = placeholder;
        });

        // Step combined output
        const stepLabel = step.label ? step.label.trim() : `Step ${stepIdx}`;
        const stepPlaceholder = `(Combined Output of Step: \{\{${stepLabel}\}\})`;
        contextVault[step.id] = stepPlaceholder;
        contextVault[`s${stepIdx}`] = stepPlaceholder;
        if (step.label) contextVault[step.label.trim()] = stepPlaceholder;
    });

    // 2. Expand prompts for all tasks
    const results = [];
    const placeholderRegex = /\(Output of Task: [^)]+\)|\(Combined Output of Step: [^)]+\)/g;
    const maxContext = await getMaxContextTokens();
    const maxResponse = getMaxResponseTokens();
    const availableBudget = maxContext - maxResponse;

    for (let sIdx = 0; sIdx < pipeline.steps.length; sIdx++) {
        const step = pipeline.steps[sIdx];
        for (let tIdx = 0; tIdx < step.tasks.length; tIdx++) {
            const task = step.tasks[tIdx];
            try {
                const assembled = await expandPrompt(task.template || '', settings, contextVault, cleanChat, stContext, true);
                const tokens = await countTokens(assembled);
                const placeholders = (assembled.match(placeholderRegex) || []).length;

                // Escape HTML for safety and wrap placeholders in colored spans
                const safeContent = assembled.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const highlightedContent = safeContent.replace(placeholderRegex, (match) => {
                    return `<span class="polyceph-preview-placeholder">${match}</span>`;
                });

                results.push({
                    title: `Step ${sIdx + 1} - ${task.label || `Task ${tIdx + 1}`}`,
                    content: highlightedContent,
                    tokens,
                    placeholders,
                    limit: availableBudget
                });
            } catch (err) {
                logger.error('Preview expansion failed:', err);
                results.push({
                    title: `Step ${sIdx + 1} - ${task.label || `Task ${tIdx + 1}`}`,
                    content: `Error during expansion: ${err.message}`,
                    tokens: 0,
                    placeholders: 0,
                    limit: availableBudget
                });
            }
        }
    }

    // 3. Render HTML
    const html = results.map((res, idx) => `
        <div class="polyceph-preview-task-container polyceph-preview-page ${idx === 0 ? 'active' : ''}" data-page="${idx}">
            <div class="polyceph-preview-task-header">
                <span>${res.title}</span>
                <div style="display: flex; gap: 15px; font-size: 0.8em; font-weight: normal;">
                    <span title="Estimated tokens / Max allowed tokens (Total Context Limit: ${maxContext})">
                        <i class="fa-solid fa-microchip"></i> ${res.tokens} / <span style="color: var(--SmartThemeQuoteColor);">${res.limit}</span> <span style="opacity: 0.7; font-size: 0.9em;">(Total: ${maxContext})</span> tokens
                    </span>
                    ${res.placeholders > 0 ? `
                    <span class="polyceph-preview-placeholder-count" title="Number of unexpanded task placeholders in this prompt">
                        <i class="fa-solid fa-puzzle-piece"></i> ${res.placeholders} placeholders
                    </span>` : ''}
                </div>
            </div>
            <div class="polyceph-preview-textarea polyceph-preview-div">${res.content}</div>
        </div>
    `).join('');

    const pagination = `
        <div class="polyceph-preview-pagination">
            ${results.map((_, idx) => `
                <button class="polyceph-page-btn ${idx === 0 ? 'active' : ''}" data-page="${idx}">${idx + 1}</button>
            `).join('')}
        </div>
    `;

    // 4. Show Modal
    const modalContent = `
        <div class="polyceph-preview-modal-content">
            <h3 style="margin-top: 0; display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-eye"></i> Pipeline Prompt Preview
            </h3>
            <p style="font-size: 0.9em; opacity: 0.8; margin-bottom: 20px;">
                This view shows exactly how each prompt is assembled. 
                <span style="color: var(--SmartThemeQuoteColor); font-weight: bold;">Highlights</span> represent outputs from previous tasks.
            </p>
            <div class="polyceph-preview-list">
                ${html}
            </div>
            ${pagination}
        </div>
    `;

    // Attach global listener if not already present
    if (!window.polyceph_preview_initialized) {
        $(document).on('click', '.polyceph-page-btn', function () {
            const pageIdx = $(this).data('page');
            const container = $(this).closest('.polyceph-preview-modal-content');

            // Update buttons
            container.find('.polyceph-page-btn').removeClass('active');
            $(this).addClass('active');

            // Update pages
            container.find('.polyceph-preview-page').removeClass('active');
            container.find(`.polyceph-preview-page[data-page="${pageIdx}"]`).addClass('active');
        });
        window.polyceph_preview_initialized = true;
    }

    if (stContext.Popup) {
        const popup = new stContext.Popup(modalContent, stContext.POPUP_TYPE?.TEXT || 0, undefined, { okButton: 'Close', wider: true, large: true, customClass: 'polyceph-preview-modal' });
        await popup.show();
    } else {
        const modalFunc = window.callGenericModal || stContext.callGenericModal;

        if (typeof modalFunc === 'function') {
            modalFunc(modalContent, 'Close', null, { large: true });
        } else {
            toastr.error('Native SillyTavern modal API not found. Check console for details.', 'Polyceph');
            logger.error('Modal API missing. window.callGenericModal:', typeof window.callGenericModal, 'stContext.callGenericModal:', typeof stContext.callGenericModal, 'stContext.Popup:', !!stContext.Popup);
        }
    }
}
