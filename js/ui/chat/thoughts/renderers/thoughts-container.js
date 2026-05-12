import { logger } from '../../../../logger.js';
import { settings } from '../../../../state.js';
import { generateSingleThoughtHTML } from './single-thought.js';

/**
 * Generates the full HTML container for a list of thoughts.
 */
export function generateThoughtsHTML(thoughtsArray, pipelineName) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';

    // 1. Filtering logic for 'showOnlyLastRecursion'
    let displayThoughts = thoughtsArray;
    if (settings.showOnlyLastRecursion) {
        console.log('[Polyceph] showOnlyLastRecursion is ENABLED. Filtering thoughtsArray...', { originalLength: thoughtsArray.length });
        const tasks = new Map();
        // Group by taskId and find max turnIndex for each
        for (const t of thoughtsArray) {
            const taskId = t.taskId || 'default';
            if (!tasks.has(taskId) || t.turnIndex > tasks.get(taskId).maxTurn) {
                tasks.set(taskId, { maxTurn: t.turnIndex });
            }
        }
        // Filter to keep only the last turn for each task
        displayThoughts = thoughtsArray.filter(t => {
            const taskId = t.taskId || 'default';
            return t.turnIndex === tasks.get(taskId).maxTurn;
        });

        // Strip "Recursion N" from titles for a cleaner look
        displayThoughts = displayThoughts.map(t => ({
            ...t,
            title: t.title ? t.title.replace(/\s?\(Recursion\s\d+\)/gi, '') : t.title
        }));
    }

    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.debug(`Generating thoughts HTML for ${displayThoughts.length} items (original: ${thoughtsArray.length}). ID: ${thoughtsId}`);

    let htmlBlocks = '';
    for (let i = 0; i < displayThoughts.length; i++) {
        const current = displayThoughts[i];
        const next = displayThoughts[i + 1];

        htmlBlocks += generateSingleThoughtHTML(current);

        // Only add separator if the next thought is in a DIFFERENT recursion/turn
        if (next && current.turnIndex !== next.turnIndex) {
            htmlBlocks += '\n<div class="polyceph-thought-separator"></div>\n';
        }
    }

    if (!htmlBlocks) {
        logger.warn('generateThoughtsHTML produced empty block list despite non-empty thoughtsArray.');
        return '';
    }

    return `<div id="${thoughtsId}" class="polyceph-thoughts">
        <div class="polyceph-thoughts-details">
            <div class="polyceph-thought-summary">
                <div class="polyceph-thought-summary-container" onclick="this.parentElement.parentElement.classList.toggle('polyceph-thoughts-open');">
                    <div class="polyceph-thought-summary-title">
                        <b>Reasoning</b>
                        ${pipelineName ? `<span class="polyceph-header-metadata">${pipelineName}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="polyceph-thought-items">
                ${htmlBlocks}
            </div>
        </div>
    </div>`;
}
