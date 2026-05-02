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

    // 3. Check for standalone {{world_info}} macro
    const hasStandaloneWI = result.includes('{{world_info}}');
    let shouldInjectWIIntoHistory = true;

    if (hasStandaloneWI) {
        try {
            const { getWorldInfoForChat } = await import('../compat-shared.js');
            const wi = await getWorldInfoForChat(cleanChat, isDryRun, 'normal', resolvedInput);
            const wiText = wi ? (wi.before + wi.after) : ''; 
            result = result.replace(/\{\{world_info\}\}/g, wiText);
            shouldInjectWIIntoHistory = false;
            logger.debug('[Polyceph] Resolved {{world_info}} macro.');
        } catch (e) {
            logger.error('[Polyceph] Failed to resolve standalone {{world_info}} macro:', e);
            result = result.replace(/\{\{world_info\}\}/g, '');
        }
    }

    // 4. Resolve Chat Completion Prompts (Token-aware macros like {{system_prompt}})
    // We do this before overhead calculation so their size is known.
    result = await resolveCCMacros(result, cleanChat, stContext, null, contextVault);

    // 5. Resolve SillyTavern standard macros (Description, Persona, Char, etc.)
    if (typeof stContext.substituteParams === 'function') {
        result = stContext.substituteParams(result);
    }

    // 6. Calculate template overhead (tokens used by other macros and static text)
    // We strip the chat_history placeholders to count everything else.
    const overheadText = result.replace(/\{\{chat_history(?:\|[^}]+)?\}\}/g, '');
    let overheadTokens = 0;
    try {
        const { countTokens } = await import('../compat-shared.js');
        overheadTokens = await countTokens(overheadText);
        logger.debug(`[Polyceph] Accurate template overhead (including CC macros): ${overheadTokens} tokens`);
    } catch (e) {
        logger.warn('[Polyceph] Failed to calculate template overhead:', e);
    }

    // 7. Resolve Chat History (with current input, WI awareness, and accurate overhead)
    result = await resolveChatHistory(result, cleanChat, stContext, isDryRun, resolvedInput, shouldInjectWIIntoHistory, overheadTokens);

    // 8. Apply the resolved {{user_input}}
    result = result.replace(/\{\{user_input\}\}/g, userInputPlaceholder);

    // 9. Resolve remaining contextVault items (Task/Step placeholders)
    if (contextVault) {
        Object.keys(contextVault).forEach(key => {
            // Escape key for regex
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
            result = result.replace(regex, contextVault[key]);
        });
    }

    return result;
}

export { resolveChatHistory } from './history.js';
export { resolveCCMacros } from './chat-completion.js';
export { weaveInjections } from './history.js';
