import { logger } from './utils.js';
import { resolveChatHistory } from './history.js';
import { resolveCCMacros } from './chat-completion.js';

/**
 * Fully expands a prompt by resolving Polyceph-specific recursion and custom macros.
 */
export async function expandPrompt(template, settings, contextVault, cleanChat, stContext) {
    let result = template || '';

    const macroMatch = result.match(/\{\{[^}]+\}\}/g);
    if (macroMatch) {
        logger.debug(`Expanding template with macros: ${macroMatch.join(', ')}`);
    }

    // 1. Resolve recursive {{polyceph_prompt}}
    const globalPrompt = settings.polycephPrompt || '';
    result = result.replace(/\{\{polyceph_prompt\}\}/g, globalPrompt);

    // 2. Resolve Chat History (with params)
    result = await resolveChatHistory(result, cleanChat, stContext);

    // 3. Resolve Chat Completion Prompts (Token-aware)
    result = await resolveCCMacros(result, cleanChat, stContext, null, contextVault);

    // 4. Resolve {{user_input}} with explicit user role
    const resolvedInput = contextVault?.['user_input'] || settings.userInput || '';
    result = result.replace(/\{\{user_input\}\}/g, `[[ROLE:user]]\n${resolvedInput}\n[[/ROLE]]`);

    // 5. Resolve remaining contextVault items (Task/Step placeholders)
    if (contextVault) {
        Object.keys(contextVault).forEach(key => {
            // Escape key for regex
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
            result = result.replace(regex, contextVault[key]);
        });
    }

    // 6. Resolve SillyTavern standard macros
    if (typeof stContext.substituteParams === 'function') {
        result = stContext.substituteParams(result, {
            dynamicMacros: contextVault
        });
    }

    return result;
}

export { resolveChatHistory } from './history.js';
export { resolveCCMacros } from './chat-completion.js';
export { weaveInjections } from './history.js';
