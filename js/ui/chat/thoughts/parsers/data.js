import { parseInternalYaml } from './yaml.js';
import { parseInternalXml } from './xml.js';

/**
 * Tries to parse internal data formats like JSON, YAML, or XML.
 * Returns { data, format }
 */
export function tryParseInternalData(text) {
    if (typeof text !== 'string') return { data: text, format: null };
    const trimmed = text.trim();

    // 1. Try JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return { data: JSON.parse(trimmed), format: 'JSON' };
        } catch (e) {}
    }

    // 2. Try XML
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
            const data = parseInternalXml(trimmed);
            if (data && Object.keys(data).length > 0) return { data, format: 'XML' };
        } catch (e) {}
    }

    // 3. Try YAML (Robust indentation-aware)
    try {
        const data = parseInternalYaml(trimmed);
        if (data && Object.keys(data).length > 0) {
            // Check if it's actually just a string (one key with no value and no nesting)
            const keys = Object.keys(data);
            if (keys.length === 1 && data[keys[0]] === null && !trimmed.includes(': ')) {
                return { data: text, format: null };
            }
            return { data, format: 'YAML' };
        }
    } catch (e) {}

    return { data: text, format: null };
}
