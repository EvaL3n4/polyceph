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

    // Regex for: {{chat_history|last:10|live:true|bg_last:2}}
    return text.replace(/\{\{chat_history(?:\|([^}]+))?\}\}/g, (match, params) => {
        const options = {};
        if (params) {
            params.split('|').forEach(p => {
                const [key, val] = p.split(':').map(s => s.trim().toLowerCase());
                if (key) options[key] = val;
            });
        }

        // 1. Select Source
        let source = (options.live === 'true') ? 
            stContext.chat.filter(m => m && !m.extra?.polyceph_typing) : 
            cleanChat;

        // 2. Filter Background Messages (preserve order)
        let filteredMessages = source;
        if (options.bg_last !== undefined) {
            const bgLimit = parseInt(options.bg_last);
            const backgroundMsgs = source.filter(m => m && m.extra?.polyceph_hidden);
            
            if (backgroundMsgs.length > bgLimit) {
                const keepBgs = backgroundMsgs.slice(-bgLimit);
                filteredMessages = source.filter(m => {
                    // Keep if not hidden OR if it's one of the last N hidden ones
                    if (!m.extra?.polyceph_hidden) return true;
                    return keepBgs.includes(m);
                });
            }
        }

        // 3. Map to Strings
        let history = filteredMessages.map(m => `${m.name}: ${m.mes}`);

        // 4. Apply Final Limit
        if (options.last !== undefined) {
            const lastN = parseInt(options.last);
            if (!isNaN(lastN)) {
                history = history.slice(-lastN);
            }
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
