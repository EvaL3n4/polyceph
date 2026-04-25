/**
 * Polyceph Macro Resolution System
 */

/**
 * Resolves Polyceph-specific chat history macros.
 * Handles: {{chat_history}}, {{chat_history:N}}, {{chat_history:live}}, {{chat_history:live:N}}
 * 
 * @param {string} text - The prompt text to process
 * @param {Array} cleanChat - Snapshot of the chat array without typing indicators
 * @param {object} stContext - SillyTavern context
 * @returns {string} - Processed text
 */
export function resolveChatHistory(text, cleanChat, stContext) {
    if (!text) return text;

    return text.replace(/\{\{chat_history(?::(\w+))?(?::(\d+))?\}\}/g, (match, param1, param2) => {
        let source = cleanChat;
        let count = null;
        
        // Handle variants: 
        // {{chat_history:10}} -> param1 is "10"
        // {{chat_history:live}} -> param1 is "live"
        // {{chat_history:live:10}} -> param1 is "live", param2 is "10"

        if (param1 === 'live') {
            source = stContext.chat.filter(m => m && !m.extra?.polyceph_typing);
            if (param2 && !isNaN(param2)) {
                count = parseInt(param2);
            }
        } else if (param1 && !isNaN(param1)) {
            count = parseInt(param1);
        }

        let history = source.map(m => `${m.name}: ${m.mes}`);
        if (count) {
            history = history.slice(-count);
        }
        return history.join('\n\n');
    });
}

/**
 * Fully expands a prompt by resolving Polyceph-specific recursion and custom macros.
 * 
 * @param {string} template - The starting template
 * @param {object} settings - Extension settings
 * @param {object} contextVault - The current macro values
 * @param {Array} cleanChat - Chat snapshot
 * @param {object} stContext - SillyTavern context
 * @returns {string} - Fully expanded prompt string
 */
export function expandPrompt(template, settings, contextVault, cleanChat, stContext) {
    let result = template || '';

    // 1. Resolve recursive {{polyceph_prompt}}
    // We do this first so that any macros inside the global prompt can be resolved in the next steps
    const globalPrompt = settings.polycephPrompt || '';
    result = result.replace(/\{\{polyceph_prompt\}\}/g, globalPrompt);

    // 2. Resolve Custom Polyceph Macros (Chat History)
    result = resolveChatHistory(result, cleanChat, stContext);

    // 3. Resolve SillyTavern standard macros and remaining contextVault items
    if (typeof stContext.substituteParams === 'function') {
        result = stContext.substituteParams(result, {
            dynamicMacros: contextVault
        });
    }

    return result;
}
