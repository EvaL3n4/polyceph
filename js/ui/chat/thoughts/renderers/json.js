import { tryParseInternalData } from '../parsers/data.js';
import { parseMarkdown } from '../parsers/markdown.js';

/**
 * Renders a JSON-like object into a clean, nested UI structure.
 */
export function renderJsonObject(data, isRoot = false, preferredFormat = null) {
    if (data === null || data === undefined) return '<span class="polyceph-json-null">null</span>';

    if (typeof data !== 'object') {
        let str = String(data);
        if (typeof data === 'boolean') return `<span class="polyceph-json-boolean">${str}</span>`;
        if (typeof data === 'number') return `<span class="polyceph-json-number">${str}</span>`;

        // Parse markdown formatting for strings
        str = parseMarkdown(str);
        
        return `<span class="polyceph-json-string">${str}</span>`;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) return '<span class="polyceph-json-empty">(empty)</span>';
        return `
            <div class="polyceph-json-array">
                ${data.map(item => {
                    const parsed = tryParseInternalData(item, preferredFormat);
                    return `
                        <div class="polyceph-json-item-box">
                            ${parsed.format ? `<div class="polyceph-json-item-header"><span class="polyceph-json-format-mini">${parsed.format}</span></div>` : ''}
                            <div class="polyceph-json-item-content">${renderJsonObject(parsed.data, false, parsed.format || preferredFormat)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }


    const keys = Object.keys(data);
    if (keys.length === 0) return '<span class="polyceph-json-empty">(empty)</span>';

    // Extract status-related fields for a compact header ONLY at the root of a tool section
    const statusKeys = ['status', 'success', 'ok', 'error'];
    const headerFields = isRoot ? keys.filter(k => statusKeys.includes(k.toLowerCase())) : [];
    const bodyFields = keys.filter(k => !headerFields.includes(k));

    let headerHtml = '';
    if (headerFields.length > 0) {
        headerHtml = `
            <div class="polyceph-json-status-bar">
                ${headerFields.map(k => {
                    const val = data[k];
                    const kLower = k.toLowerCase();
                    const isErrorField = kLower === 'error';
                    
                    let type = 'neutral';
                    if (!isErrorField) {
                        const isOk = (val === true || String(val).toLowerCase() === 'ok' || String(val).toLowerCase() === 'success' || String(val).toLowerCase() === 'true');
                        type = isOk ? 'ok' : 'error';
                    } else {
                        const isError = (val === true || (typeof val === 'string' && val.trim() !== '' && val !== 'false' && val !== '[]' && val !== 'none'));
                        type = isError ? 'error' : 'ok';
                    }

                    const icon = type === 'ok' ? 'fa-check-circle' : 'fa-circle-xmark';
                    let displayVal = val;
                    if (Array.isArray(val) && val.length === 0) displayVal = 'none';

                    return `
                        <div class="polyceph-json-status-pill polyceph-status-${type}">
                            <span class="polyceph-status-key">${k.toUpperCase()}</span>
                            <span class="polyceph-status-val"><i class="fa-solid ${icon}"></i> ${displayVal}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    const bodyHtml = bodyFields.map(key => {
        const parsed = tryParseInternalData(data[key], preferredFormat);
        const isSimple = (typeof parsed.data !== 'object' || parsed.data === null || (Array.isArray(parsed.data) && parsed.data.length === 0));
        const rowClass = isSimple ? 'polyceph-json-field-horizontal' : 'polyceph-json-field-vertical';

        return `
            <div class="polyceph-json-field-box ${rowClass}">
                <div class="polyceph-json-key-container">
                    <span class="polyceph-json-key">${key}</span>
                    ${parsed.format ? `<span class="polyceph-json-format-mini">${parsed.format}</span>` : ''}
                </div>
                <div class="polyceph-json-value">${renderJsonObject(parsed.data, false, parsed.format || preferredFormat)}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="polyceph-json-object">
            ${headerHtml}
            <div class="polyceph-json-body">${bodyHtml}</div>
        </div>
    `;
}
