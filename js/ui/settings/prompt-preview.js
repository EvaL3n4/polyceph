import { getActivePipeline, settings } from '../../state.js';
import { expandPrompt } from '../../macros/macros.js';
import { logger } from '../../logger.js';
import { countTokens, getMaxContextTokens, getMaxResponseTokens } from '../../compat-shared.js';
import { initSearchListeners } from './search-manager.js';
import { createPromptEditor } from './prompt-editor.js';

/**
 * Generates and displays a modal with the assembled prompts for each task in the active pipeline.
 */
export async function showPromptPreview(initialPageIndex = 0) {
    // ... (rest of the setup code remains the same)
    const pipeline = getActivePipeline();
    const stContext = SillyTavern.getContext();

    // Ensure initialPageIndex is within bounds
    const totalTasks = pipeline.steps.reduce((acc, s) => acc + s.tasks.length, 0);
    if (initialPageIndex >= totalTasks) initialPageIndex = 0;

    // Use the current chat state, excluding typing indicators and system commands
    const cleanChat = stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/'));

    // 1. Prepare contextVault with placeholders for task/step outputs
    const contextVault = {};
    pipeline.steps.forEach((step, sIdx) => {
        const stepIdx = sIdx + 1;

        step.tasks.forEach((task, tIdx) => {
            const taskIdIndx = tIdx + 1;
            const label = task.label ? task.label.trim() : `Task ${taskIdIndx}`;
            // Just use the macro itself as the placeholder
            const placeholder = `{{${label}}}`;

            // Map all standard keys used by the orchestrator
            contextVault[`${step.id}_task_${taskIdIndx}`] = placeholder;
            contextVault[`${step.id}_target_${taskIdIndx}`] = placeholder;
            contextVault[`s${stepIdx}k${taskIdIndx}`] = placeholder;
            contextVault[`s${stepIdx}t${taskIdIndx}`] = placeholder;
            if (task.label) contextVault[task.label.trim()] = placeholder;
        });

        // Step combined output
        const stepLabel = step.label ? step.label.trim() : `Step ${stepIdx}`;
        const stepPlaceholder = `{{${stepLabel}}}`;
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

    // Collect all task and step labels for highlighting
    const allLabels = [];
    pipeline.steps.forEach(step => {
        if (step.label) allLabels.push(step.label.trim());
        step.tasks.forEach(task => {
            if (task.label) allLabels.push(task.label.trim());
        });
    });

    for (let sIdx = 0; sIdx < pipeline.steps.length; sIdx++) {
        const step = pipeline.steps[sIdx];
        for (let tIdx = 0; tIdx < step.tasks.length; tIdx++) {
            const task = step.tasks[tIdx];
            try {
                const assembled = await expandPrompt(task.template || '', settings, contextVault, cleanChat, stContext, true);
                const tokens = await countTokens(assembled);
                const placeholders = 0; // We don't need to count these manually anymore

                results.push({
                    title: `Step ${sIdx + 1} - ${task.label || `Task ${tIdx + 1}`}`,
                    content: assembled,
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
        <div class="polyceph-preview-task-container polyceph-preview-page ${idx === initialPageIndex ? 'active' : ''}" data-page="${idx}">

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
            <textarea id="polyceph-preview-task-${idx}" class="polyceph-preview-textarea polyceph-preview-cm" readonly disabled>${res.content}</textarea>
        </div>
    `).join('');

    const pagination = `
        <div class="polyceph-preview-pagination">
            ${results.map((_, idx) => `
                <button class="polyceph-page-btn ${idx === initialPageIndex ? 'active' : ''}" data-page="${idx}">${idx + 1}</button>
            `).join('')}
        </div>
    `;

    // 4. Show Modal
    const modalContent = `
        <div class="polyceph-preview-modal-content">
            <h3 style="margin-top: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-eye"></i> Pipeline Prompt Preview
            </h3>
            <p style="font-size: 0.85em; opacity: 0.7; margin-top: 0; margin-bottom: 20px; background: var(--black30a); padding: 8px 12px; border-radius: 4px; border-left: 3px solid var(--SmartThemeQuoteColor);">
                <i class="fa-solid fa-circle-info"></i> <b>Note:</b> Some third-party extension injections may not be shown in this preview because they are resolved during pipeline runtime (probably sending prompts and stuff).
            </p>
            <div class="polyceph-preview-search-container">
                <div class="polyceph-preview-search-input-wrapper">
                    <input type="text" id="polyceph_preview_search_input" placeholder="Search prompt text..." class="text_pole">
                    <div class="polyceph-preview-search-controls">
                        <span id="polyceph_preview_search_count">0/0</span>
                        <i id="polyceph_preview_search_prev" class="fa-solid fa-chevron-up" title="Previous"></i>
                        <i id="polyceph_preview_search_next" class="fa-solid fa-chevron-down" title="Next"></i>
                    </div>
                </div>
                <div class="polyceph-preview-search-options">
                    <label title="Search Current Page Only">
                        <input type="checkbox" id="polyceph_preview_search_scope" checked> Page
                    </label>
                    <label title="Case Sensitive">
                        <input type="checkbox" id="polyceph_preview_search_case"> Aa
                    </label>
                    <label title="Use Regular Expression">
                        <input type="checkbox" id="polyceph_preview_search_regex"> .*
                    </label>
                </div>
            </div>
            <div class="polyceph-preview-list">
                ${html}
            </div>
            ${pagination}
            <!-- Sentinel image to signal DOM readiness -->
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" 
                 style="display:none;" 
                 onload="window.polyceph_on_preview_ready()">
        </div>
    `;

    // Attach global listener if not already present
    if (!window.polyceph_preview_initialized) {
        function switchPage(container, pageIdx) {
            container.find('.polyceph-page-btn').removeClass('active');
            container.find(`.polyceph-page-btn[data-page="${pageIdx}"]`).addClass('active');
            container.find('.polyceph-preview-page').removeClass('active');
            container.find(`.polyceph-preview-page[data-page="${pageIdx}"]`).addClass('active');

            // Re-refresh CodeMirror for the newly visible page
            container.find(`.polyceph-preview-page[data-page="${pageIdx}"] .CodeMirror`).each(function () {
                if (this.CodeMirror) this.CodeMirror.refresh();
            });
        }

        $(document).on('click', '.polyceph-page-btn', function () {
            const pageIdx = $(this).data('page');
            const container = $(this).closest('.polyceph-preview-modal-content');
            switchPage(container, pageIdx);
        });

        initSearchListeners($('.polyceph-preview-modal-content'), switchPage);
        window.polyceph_preview_initialized = true;
    }

    // Global hook for the sentinel
    window.polyceph_on_preview_ready = () => {
        console.log(`[Polyceph] Preview modal sentinel triggered. Initializing editors with ${allLabels.length} labels...`);
        $('.polyceph-preview-cm').each(function () {
            createPromptEditor(this, null, allLabels);
        });
        // Cleanup
        delete window.polyceph_on_preview_ready;
    };

    if (stContext.Popup) {
        const popup = new stContext.Popup(modalContent, stContext.POPUP_TYPE?.TEXT || 0, undefined, { okButton: 'Close', wider: true, large: true, customClass: 'polyceph-preview-modal' });
        await popup.show();
    } else {
        const modalFunc = window.callGenericModal || stContext.callGenericModal;

        if (typeof modalFunc === 'function') {
            modalFunc(modalContent, 'Close', null, { large: true });
        } else {
            toastr.error('Native SillyTavern modal API not found. Check console for details.', 'Polyceph');
        }
    }
}
