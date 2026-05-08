/**
 * Backward compatibility shim for thoughts-renderer.js.
 * All logic has been moved to the ./thoughts/ directory.
 */

import {
    renderPolycephThoughts,
    renderPolycephTyping,
    generateThoughtsHTML,
    generateSingleThoughtHTML
} from './thoughts/index.js';

export {
    renderPolycephThoughts,
    renderPolycephTyping,
    generateThoughtsHTML,
    generateSingleThoughtHTML
};
