import { setInternalPath, getInternalPath } from './path-utils.js';

/**
 * Robust YAML parser adapted for internal use.
 */
export function parseInternalYaml(yamlString) {
    const lines = yamlString.split('\n');
    const result = {};
    const path = [];
    let currentIndent = -1;

    let hasActualKV = false;
    const trimmedYaml = yamlString.trim();

    // Support for inline compact JSON/YAML (unquoted keys)
    if (trimmedYaml.startsWith('{') && trimmedYaml.endsWith('}')) {
        try {
            // Relaxed JSON parse: Quote unquoted keys
            const quoted = trimmedYaml.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
            const data = JSON.parse(quoted);
            if (data && typeof data === 'object') return data;
        } catch (e) {}
    }

    // Safety: If it's a single line and contains commas, it's likely just a string (e.g. "Atmosphere: Sterile, high-tech, and focused")
    // BUT if it starts with { or [, it's likely compact JSON/YAML data, so we allow it.
    const isWrapped = (yamlString.startsWith('{') && yamlString.endsWith('}')) || (yamlString.startsWith('[') && yamlString.endsWith(']'));
    if (!yamlString.includes('\n') && yamlString.includes(',') && !isWrapped) return null;

    for (let line of lines) {
        const rawLine = line;
        line = line.trimEnd();
        if (line === '' || line.trim().startsWith('#')) continue;

        const indent = rawLine.search(/\S|$/);
        const trimmed = line.trim();
        const isListItem = trimmed.startsWith('- ');
        const kvSep = line.indexOf(': ');

        // A valid KV separator must be followed by a space or end of line
        const isValidKV = kvSep !== -1 && (kvSep === line.length - 1 || line[kvSep + 1] === ' ');

        if (isValidKV) {
            hasActualKV = true;
        }

        // Adjust path based on indentation
        if (indent > currentIndent) {
            path.push('');
        } else if (indent < currentIndent) {
            // Find level based on indentation (assuming 2 spaces)
            const level = Math.max(0, Math.floor(indent / 2));
            path.length = level + 1;
        }
        currentIndent = indent;

        if (isListItem) {
            const value = trimmed.slice(2).trim();
            const parent = getInternalPath(result, path.slice(0, -1));
            if (!Array.isArray(parent)) {
                setInternalPath(result, path.slice(0, -1), []);
            }
            const arr = getInternalPath(result, path.slice(0, -1));
            arr.push(parseInternalYamlValue(value));
        } else if (trimmed.endsWith(':')) {
            const key = trimmed.slice(0, -1).trim();
            path[path.length - 1] = key;
            setInternalPath(result, path, {});
        } else if (isValidKV) {
            const key = line.slice(0, kvSep).trim();
            const value = line.slice(kvSep + 2).trim();
            path[path.length - 1] = key;
            setInternalPath(result, path, parseInternalYamlValue(value));
        } else {
            // Just a key or a string?
            const key = trimmed;
            path[path.length - 1] = key;
            setInternalPath(result, path, null);
        }
    }

    return hasActualKV ? result : null;
}

/**
 * Parses a YAML value.
 */
export function parseInternalYamlValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~' || value === '') return null;
    if (!isNaN(value) && value !== '') return Number(value);
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
    return value;
}
