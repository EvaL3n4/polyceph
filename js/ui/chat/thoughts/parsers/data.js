import { parseInternalYaml } from './yaml.js';
import { parseInternalXml } from './xml.js';

/**
 * Tries to parse internal data formats like JSON, YAML, or XML.
 * Returns { data, format }
 */
export function tryParseInternalData(text, preferredFormat = null) {
    if (typeof text !== 'string') return { data: text, format: null };
    const trimmed = text.trim();
    if (!trimmed) return { data: text, format: null };

    // 1. Try JSON (Always high priority if it looks like JSON)
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return { data: JSON.parse(trimmed), format: 'JSON' };
        } catch (e) {}
    }

    // If we have a preferred format and it's NOT JSON, but the text looks like it could be XML/YAML,
    // we should try the preferred one first.

    // 2. Try XML
    const looksLikeXml = trimmed.startsWith('<') && trimmed.endsWith('>');
    if (looksLikeXml || preferredFormat === 'XML') {
        try {
            const data = parseInternalXml(trimmed);
            if (data && Object.keys(data).length > 0) return { data, format: 'XML' };
        } catch (e) {}
    }

    // 3. Try YAML (Robust indentation-aware)
    // If we are in a JSON/XML context, we should be extremely skeptical of YAML unless it's multiline.
    // Narrative text often looks like a single-line YAML KV pair.
    const isMultiline = trimmed.includes('\n');
    const shouldTryYaml = preferredFormat === 'YAML' || (preferredFormat === null && (isMultiline || trimmed.includes(': ')));

    if (shouldTryYaml) {
        try {
            const data = parseInternalYaml(trimmed);
            if (data && Object.keys(data).length > 0) {
                // Additional skepticism if we have a non-YAML preferred format
                if (preferredFormat && preferredFormat !== 'YAML') {
                    // Only accept YAML inside JSON/XML if it's clearly structured (multiline)
                    if (!isMultiline) return { data: text, format: null };
                }

                // Check if it's actually just a string (one key with no value and no nesting)
                const keys = Object.keys(data);
                if (keys.length === 1 && data[keys[0]] === null && !trimmed.includes(': ')) {
                    return { data: text, format: null };
                }
                return { data, format: 'YAML' };
            }
        } catch (e) {}
    }

    return { data: text, format: null };
}
