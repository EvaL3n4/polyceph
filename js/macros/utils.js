import { logger } from '../logger.js';

/**
 * Wraps content in [[ROLE:role]] tags.
 */
export const wrapRole = (role, content) => {
    if (!content || !String(content).trim()) return '';
    return `[[ROLE:${role}]]\n${String(content).trim()}\n[[/ROLE]]`;
};

export { logger };
