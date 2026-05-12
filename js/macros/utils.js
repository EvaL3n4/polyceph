import { logger } from '../logger.js';

/**
 * Wraps content in [[ROLE:role]] tags.
 */
export const wrapRole = (role, content) => {
    if (!content || !String(content).trim()) return '';
    return `[[ROLE:${role}]]\n${String(content).trim()}\n[[/ROLE]]`;
};

/**
 * Encodes data to a safe hex string for embedding in prompt tags.
 */
export const encodeInvocations = (data) => {
    if (!data) return '';
    const json = JSON.stringify(data);
    return Array.from(new TextEncoder().encode(json))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Decodes a hex string back to original data.
 */
export const decodeInvocations = (hex) => {
    if (!hex) return null;
    try {
        const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json);
    } catch (e) {
        logger.warn('Failed to decode hex invocations:', e);
        return null;
    }
};

export { logger };
