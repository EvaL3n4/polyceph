/**
 * Sets a value at a nested path in an object.
 */
export function setInternalPath(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {};
        current = current[segment];
    }
    current[path[path.length - 1]] = value;
}

/**
 * Gets a value at a nested path in an object.
 */
export function getInternalPath(obj, path) {
    let current = obj;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}
