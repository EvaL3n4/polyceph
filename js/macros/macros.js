import { logger } from './utils.js';
import { resolveChatHistory } from './history.js';
import { resolveCCMacros } from './chat-completion.js';

/**
 * Fully expands a prompt by resolving Polyceph-specific recursion and custom macros.
 */
export async function expandPrompt(template, settings, contextVault, cleanChat, stContext, isDryRun = false) {
    let result = template || '';

    const macroMatch = result.match(/\{\{[^}]+\}\}/g);
    if (macroMatch) {
        logger.debug(`Expanding template with macros: ${macroMatch.join(', ')}`);
    }

    // 1. Resolve recursive {{polyceph_prompt}}
    const globalPrompt = settings.polycephPrompt || '';
    result = result.replace(/\{\{polyceph_prompt\}\}/g, globalPrompt);

    // 2. Capture and resolve {{user_input}} early
    // We need this so that resolveChatHistory can pass the current input to the WI scanner
    const resolvedInput = contextVault?.['user_input'] || settings.userInput || '';
    const userInputPlaceholder = `[[ROLE:user]]\n${resolvedInput}\n[[/ROLE]]`;

    // 3. Resolve Chat History (with current input awareness)
    result = await resolveChatHistory(result, cleanChat, stContext, isDryRun, resolvedInput);

    // 4. Resolve Chat Completion Prompts (Token-aware)
    result = await resolveCCMacros(result, cleanChat, stContext, null, contextVault);

    // 5. Apply the resolved {{user_input}}
    result = result.replace(/\{\{user_input\}\}/g, userInputPlaceholder);

    // 6. Resolve remaining contextVault items (Task/Step placeholders)
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
