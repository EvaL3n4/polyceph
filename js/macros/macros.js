import { logger } from './utils.js';
import { resolveChatHistory } from './history.js';
import { resolveCCMacros } from './chat-completion.js';

/**
 * Fully expands a prompt by resolving Polyceph-specific recursion and custom macros.
 */
export async function expandPrompt(template, settings, contextVault, cleanChat, stContext, isDryRun = false, signal = null) {
    if (signal?.aborted) throw new Error('Aborted');
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
            logger.debug('Resolved {{world_info}} macro.');
        } catch (e) {
            logger.error('Failed to resolve standalone {{world_info}} macro:', e);
            result = result.replace(/\{\{world_info\}\}/g, '');
        }
    }

    // 4. Resolve Chat Completion Prompts (Token-aware macros like {{system_prompt}})
    // We do this before overhead calculation so their size is known.
    result = await resolveCCMacros(result, cleanChat, stContext, null, contextVault, signal);

    // 5. Resolve SillyTavern standard macros (Description, Persona, Char, etc.)
    if (typeof stContext.substituteParams === 'function') {
        // Protection: SillyTavern's macro parser may throw warnings or errors if it encounters 
        // Polyceph's specialized macro syntax (like pipes '|') or unknown placeholders.
        const protectedMacros = [];
        const protectRegex = /\{\{[^}]+\}\}/g;
        
        // We temporarily hide macros that:
        // 1. Contain a pipe (Polyceph specialized syntax)
        // 2. Are chat_history or user_input (Polyceph handles these later with accurate token budgets)
        // 3. Are in our contextVault (Step/Task outputs)
        result = result.replace(protectRegex, (match) => {
            const inner = match.slice(2, -2);
            const baseKey = inner.split('|')[0];
            const isOurKey = contextVault && Object.prototype.hasOwnProperty.call(contextVault, baseKey);
            const isSpecial = inner.includes('|') || baseKey === 'chat_history' || baseKey === 'user_input';

            if (isSpecial || isOurKey) {
                const id = `__POLY_PROT_${protectedMacros.length}__`;
                protectedMacros.push({ id, original: match });
                return id;
            }
            return match;
        });

        // Pass the "cleaned" string to SillyTavern
        result = stContext.substituteParams(result);

        // Restore our protected macros
        protectedMacros.forEach(p => {
            result = result.replace(p.id, p.original);
        });
    }

    // 6. Calculate template overhead (tokens used by other macros and static text)
    // We strip the chat_history placeholders to count everything else.
    const overheadText = result.replace(/\{\{chat_history(?:\|[^}]+)?\}\}/g, '');
    let overheadTokens = 0;
    try {
        const { countTokens } = await import('../compat-shared.js');
        overheadTokens = await countTokens(overheadText, signal);
        logger.debug(`Accurate template overhead (including CC macros): ${overheadTokens} tokens`);
    } catch (e) {
        logger.warn('Failed to calculate template overhead:', e);
    }

    // 7. Resolve Chat History (with current input, WI awareness, and accurate overhead)
    result = await resolveChatHistory(result, cleanChat, stContext, isDryRun, resolvedInput, shouldInjectWIIntoHistory, overheadTokens, signal);

    // 8. Apply the resolved {{user_input}}
    result = result.replace(/\{\{user_input\}\}/g, userInputPlaceholder);

    // 9. Resolve remaining contextVault items (Task/Step placeholders)
    if (contextVault) {
        Object.keys(contextVault).forEach(key => {
            // Only process base keys (ignore our internal _clean suffixes)
            if (key.endsWith('_clean')) return;

            // Escape key for regex
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Support {{key}}, {{key|clean}}, {{key|history}}, {{key|raw}}
            const regex = new RegExp(`\\{\\{${escapedKey}(?:\\|(history|raw|clean))?\\}\\}`, 'g');
            
            result = result.replace(regex, (match, pipe) => {
                if (pipe === 'clean') {
                    return contextVault[`${key}_clean`] || contextVault[key];
                }
                // Default (or |history/|raw) is the raw role-tagged content
                return contextVault[key];
            });
        });
    }

    return result;
}

export { resolveChatHistory } from './history.js';
export { resolveCCMacros } from './chat-completion.js';
export { weaveInjections } from './history.js';
