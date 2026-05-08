import { logger } from '../../../../logger.js';
import { generateSingleThoughtHTML } from './single-thought.js';

/**
 * Generates the full HTML container for a list of thoughts.
 */
export function generateThoughtsHTML(thoughtsArray, pipelineName) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';

    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.debug(`Generating thoughts HTML for ${thoughtsArray.length} items. ID: ${thoughtsId}`);

    let htmlBlocks = '';
    for (let i = 0; i < thoughtsArray.length; i++) {
        const current = thoughtsArray[i];
        const next = thoughtsArray[i + 1];

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
