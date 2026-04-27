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
            stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system) : 
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
        const isCC = stContext.mainApi === 'openai';
        let history = filteredMessages.map(m => {
            if (isCC) {
                let mRole = 'assistant';
                if (m.extra?.polyceph_hidden) mRole = 'assistant';
                else if (m.is_user) mRole = 'user';
                else if (m.is_system) mRole = 'system';
                return `[[ROLE:${mRole}]]\n${m.mes}\n[[/ROLE]]`;
            }
            return `${m.name}: ${m.mes}`;
        });

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
 * Resolves all active SillyTavern Chat Completion prompts into a single string.
 */
export function resolveCCMacros(text, cleanChat, stContext, wiPrompt) {
    if (!text) return text;

    const ccSettings = stContext.chatCompletionSettings;
    if (!ccSettings || !ccSettings.prompts) return text;

    // Use current character's unique ID
    const charData = stContext.characters[stContext.characterId] || {};
    const charId = charData.id || 0;
    const allOrders = ccSettings.prompt_order || [];
    const promptOrderEntry = allOrders.find(e => String(e.character_id) === String(charId)) || 
                             allOrders.find(e => String(e.character_id) === '100001') || 
                             allOrders.find(e => String(e.character_id) === '100000') || 
                             allOrders.find(e => e.character_id === '') ||
                             allOrders[0];
    
    const rawPromptOrder = promptOrderEntry?.order || [];
    
    // Ensure all prompts from ccSettings are represented in the order
    // (ST sometimes has markers missing from the character's prompt_order list)
    const promptOrder = [...rawPromptOrder];
    
    ccSettings.prompts.forEach(p => {
        if (!promptOrder.some(e => e.identifier === p.identifier)) {
            if (p.identifier === 'personaDescription') {
                // Inject persona after worldInfoBefore or main
                let idx = promptOrder.findIndex(e => e.identifier === 'worldInfoBefore');
                if (idx === -1) idx = promptOrder.findIndex(e => e.identifier === 'main');
                promptOrder.splice(idx + 1, 0, { identifier: 'personaDescription', enabled: true });
            } else {
                promptOrder.push({ identifier: p.identifier, enabled: true });
            }
        }
    });

    const isEnabled = (id) => {
        if (id === 'main') return true;
        const entry = promptOrder.find(e => e.identifier === id);
        return entry ? entry.enabled : true;
    };

    const resolveIdentifier = (id) => {
        const prompt = ccSettings.prompts.find(p => p.identifier === id);
        if (!prompt) return '';
        
        const role = prompt.role || 'system';
        const wrap = (content) => content && String(content).trim() ? `[[ROLE:${role}]]\n${String(content).trim()}\n[[/ROLE]]` : '';

        if (prompt.marker || [
            'charDescription', 'charPersonality', 'scenario', 
            'personaDescription', 'worldInfoBefore', 'worldInfoAfter', 
            'dialogueExamples', 'chatHistory'
        ].includes(id)) {
            const char = stContext.characters[stContext.characterId];
            const charFields = typeof stContext.getCharacterCardFields === 'function' ? stContext.getCharacterCardFields() : {};

            switch (id) {
                case 'charDescription': return wrap(charFields.description || char?.description || '');
                case 'charPersonality': return wrap(charFields.personality || char?.personality || '');
                case 'scenario': return wrap(charFields.scenario || char?.scenario || '');
                case 'personaDescription': {
                    const desc = charFields.persona || stContext.powerUserSettings?.persona_description || '';
                    return wrap(desc);
                }
                case 'worldInfoBefore': return wrap(wiPrompt || '');
                case 'worldInfoAfter': return ''; // World info usually comes as one block
                case 'dialogueExamples': return wrap(charFields.mesExamples || char?.mes_example || '');
                case 'chatHistory': {
                    return cleanChat.map(m => {
                        let mRole = 'assistant';
                        if (m.extra?.polyceph_hidden) mRole = 'assistant';
                        else if (m.is_user) mRole = 'user';
                        else if (m.is_system) mRole = 'system';
                        return `[[ROLE:${mRole}]]\n${m.mes}\n[[/ROLE]]`;
                    }).join('\n\n');
                }
                default: return '';
            }
        }
        return wrap(prompt.content || '');
    };

    let result = text;

    // 1. Resolve {{cc_all_prompts}}
    result = result.replace(/\{\{cc_all_prompts\}\}/g, () => {
        const parts = [];
        // Use promptOrder to maintain the correct sequence
        promptOrder.forEach(entry => {
            if (!entry.enabled) return;
            const content = resolveIdentifier(entry.identifier);
            if (content.trim()) parts.push(content.trim());
        });
        return parts.join('\n\n');
    });

    // 2. Resolve individual macros
    result = result.replace(/\{\{cc_main_prompt\}\}/g, () => resolveIdentifier('main'));
    result = result.replace(/\{\{cc_aux_prompt\}\}/g, () => resolveIdentifier('nsfw'));
    result = result.replace(/\{\{cc_nsfw_prompt\}\}/g, () => resolveIdentifier('nsfw'));
    result = result.replace(/\{\{cc_post_history_instructions\}\}/g, () => resolveIdentifier('jailbreak'));
    result = result.replace(/\{\{cc_jailbreak_prompt\}\}/g, () => resolveIdentifier('jailbreak'));
    result = result.replace(/\{\{cc_enhance_definitions\}\}/g, () => resolveIdentifier('enhanceDefinitions'));

    return result;
}

/**
 * Fully expands a prompt by resolving Polyceph-specific recursion and custom macros.
 * 
 * @param {string} template - The starting template
 * @param {object} settings - Extension settings
 * @param {object} contextVault - The current macro values
 * @param {Array} cleanChat - Chat snapshot
 * @param {object} stContext - SillyTavern context
 * @param {string} wiPrompt - Pre-calculated World Info string
 * @returns {string} - Fully expanded prompt string
 */
export function expandPrompt(template, settings, contextVault, cleanChat, stContext, wiPrompt) {
    let result = template || '';

    // 1. Resolve recursive {{polyceph_prompt}}
    const globalPrompt = settings.polycephPrompt || '';
    result = result.replace(/\{\{polyceph_prompt\}\}/g, globalPrompt);

    // 2. Resolve Chat History (with params)
    result = resolveChatHistory(result, cleanChat, stContext);

    // 3. Resolve Chat Completion Prompts
    result = resolveCCMacros(result, cleanChat, stContext, wiPrompt);

    // 4. Resolve {{user_input}} with explicit user role
    const resolvedInput = contextVault?.['user_input'] || settings.userInput || '';
    result = result.replace(/\{\{user_input\}\}/g, `[[ROLE:user]]\n${resolvedInput}\n[[/ROLE]]`);

    // 5. Resolve SillyTavern standard macros and remaining contextVault items
    if (typeof stContext.substituteParams === 'function') {
        result = stContext.substituteParams(result, {
            dynamicMacros: contextVault
        });
    }

    return result;
}
