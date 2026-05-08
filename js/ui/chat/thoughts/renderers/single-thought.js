import { logger } from '../../../../logger.js';
import { tryParseInternalData } from '../parsers/data.js';
import { renderJsonObject } from './json.js';

/**
 * Generates HTML for a single reasoning thought block.
 */
export function generateSingleThoughtHTML(t) {
    try {
        let contentHtml = '';
        let formatLabel = '';

        if (t.type === 'tool') {
            const argsParsed = tryParseInternalData(t.content.args);
            const responseParsed = tryParseInternalData(t.content.response);
            
            formatLabel = responseParsed.format || argsParsed.format || 'DATA';

            contentHtml = `
                <div class="polyceph-tool-details">
                    <div class="polyceph-tool-section">
                        <div class="polyceph-tool-section-header">Arguments</div>
                        <div class="polyceph-tool-args-container">${renderJsonObject(argsParsed.data, true)}</div>
                    </div>
                    <div class="polyceph-tool-section">
                        <div class="polyceph-tool-section-header">Response</div>
                        <div class="polyceph-tool-response-container">${renderJsonObject(responseParsed.data, true)}</div>
                    </div>
                </div>
            `;
        } else {
            contentHtml = t.content;

            // Base64 decoding for encoded reasoning (e.g., Gemini on OpenRouter)
            if (t.title.toLowerCase().includes('thinking') && /^[A-Za-z0-9+/=]+$/.test(contentHtml) && contentHtml.length > 16) {
                try {
                    const decoded = atob(contentHtml);
                    // Check if it looks like UTF-8/Readable text
                    if (/^[\x20-\x7E\s\u00A0-\uFFFF]*$/.test(decoded)) {
                        contentHtml = decoded;
                    } else {
                        // It's likely an encrypted signature or binary blob
                        contentHtml = `<span class="polyceph-encrypted-tag">[Encrypted Reasoning (google-gemini-v1)]</span>`;
                    }
                } catch (e) {
                    // Not actually base64 or failed to decode, keep original
                }
            }

            const stContext = SillyTavern.getContext();
            if (typeof stContext.messageFormatting === 'function') {
                contentHtml = stContext.messageFormatting(contentHtml, 'Polyceph', false, false);
            } else {
                contentHtml = contentHtml.replace(/\n/g, '<br>');
            }
        }

        const openClass = t.isSilent ? '' : 'polyceph-item-open';
        const silentClass = (t.isSilent || t.type === 'tool') ? 'polyceph-silent-thought' : '';
        const toolClass = t.type === 'tool' ? 'polyceph-tool-thought' : '';

        return `<div class="polyceph-generated-thought ${openClass} ${silentClass} ${toolClass}">
            <div class="polyceph-generated-thought-name" style="cursor:pointer;" onclick="this.parentElement.classList.toggle('polyceph-item-open');">
                <span class="polyceph-item-toggle-icon">▶</span> ${t.title}
                <div class="polyceph-item-metadata-group">
                    ${formatLabel ? `<span class="polyceph-item-format-tag">${formatLabel}</span>` : ''}
                    ${t.profile ? `<span class="polyceph-item-metadata">${t.profile}</span>` : ''}
                </div>
            </div>
            <div class="polyceph-generated-thought-content">${contentHtml}</div>
        </div>`;
    } catch (err) {
        logger.error('Failed to generate HTML for thought:', t, err);
        return `<div class="polyceph-generated-thought polyceph-item-open polyceph-status-error" style="border: 1px solid var(--red);">
            <div class="polyceph-generated-thought-name">⚠️ Error rendering thought: ${t.title}</div>
            <div class="polyceph-generated-thought-content">${err.message}</div>
        </div>`;
    }
}
