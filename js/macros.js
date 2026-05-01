import { countTokens, getMaxContextTokens, getMaxResponseTokens, getMaxPromptTokens, getWorldInfoForChat } from './compat-shared.js';
import { logger } from './logger.js';

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

    // Regex for: {{chat_history|last:10|live:true|bg_last:2|injections:true}}
    return text.replace(/\{\{chat_history(?:\|([^}]+))?\}\}/g, (match, params) => {
        const options = {};
        if (params) {
            params.split('|').forEach(p => {
                const [key, val] = p.split(':').map(s => s.trim().toLowerCase());
                if (key) options[key] = val;
            });
        }

        const includeInjections = options.no_extensions !== 'true';

        // 1. Select Source
        let source = (options.live === 'true') ?
            stContext.chat.filter(m => m && !m.extra?.polyceph_typing && !m.is_system && !m.mes?.trim().startsWith('/')) :
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

        // 3. Collect Injections if enabled
        const injections = [];
        if (includeInjections && stContext.extensionPrompts) {
            Object.keys(stContext.extensionPrompts).forEach(key => {
                const prompt = stContext.extensionPrompts[key];
                if (prompt && prompt.value && prompt.value.trim()) {
                    injections.push({
                        id: key,
                        value: prompt.value.trim(),
                        depth: Number(prompt.depth || 0),
                        position: Number(prompt.position || 0),
                        role: Number(prompt.role || 0)
                    });
                }
            });
        }

        // 4. Map and Weave
        const isCC = stContext.mainApi === 'openai';
        const finalMessages = [];

        // Loop backwards to match ST's depth logic
        for (let i = filteredMessages.length - 1; i >= 0; i--) {
            const depth = filteredMessages.length - 1 - i;
            const msg = filteredMessages[i];

            // Injections at BOTTOM of this depth (Position 1)
            if (includeInjections) {
                injections.filter(inj => inj.depth === depth && inj.position === 1).forEach(inj => {
                    finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
                });
            }

            // The Message itself
            finalMessages.unshift({ ...msg, is_injection: false });

            // Injections at TOP of this depth (Position 0)
            if (includeInjections) {
                injections.filter(inj => inj.depth === depth && inj.position === 0).forEach(inj => {
                    finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
                });
            }
        }

        // Handle depths beyond chat length (e.g., Depth 1000 for top of prompt)
        if (includeInjections) {
            injections.filter(inj => inj.depth >= filteredMessages.length).forEach(inj => {
                finalMessages.unshift({ mes: inj.value, role: inj.role, is_injection: true });
            });
        }

        // 5. Format to strings
        let history = finalMessages.map(m => {
            let mRole = 'assistant';
            if (m.is_injection) {
                if (m.role === 1) mRole = 'user';
                else if (m.role === 2) mRole = 'assistant';
                else mRole = 'system';
            } else {
                if (m.extra?.polyceph_hidden) mRole = 'assistant';
                else if (m.is_user) mRole = 'user';
                else if (m.is_system) mRole = 'system';
            }

            let encodedInvocations = '';
            if (m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                encodedInvocations = `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
            }

            if (isCC) {
                return `[[ROLE:${mRole}]]\n${m.mes}${encodedInvocations}\n[[/ROLE]]`;
            }

            // For text completion, we still use a readable format
            if (mRole === 'system') return `### System Instruction:\n${m.mes}${encodedInvocations}`;
            return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}${encodedInvocations}`;
        });

        // 6. Apply Final Limit
        if (options.last !== undefined) {
            const lastN = parseInt(options.last);
            if (!isNaN(lastN)) {
                history = history.slice(-lastN);
            }
        }

        logger.debug(`Resolved {{chat_history}} with ${history.length} messages (Params: ${params || 'none'})`);
        return history.join('\n\n');
    });
}

/**
 * Resolves all active SillyTavern Chat Completion prompts into a single string.
 * Implements token-based history trimming to respect context limits by leveraging
 * SillyTavern's native ChatCompletion and Message classes.
 */
export async function resolveCCMacros(text, cleanChat, stContext, wiPrompt, contextVault) {
    if (!text) return text;

    const ccSettings = stContext.chatCompletionSettings;
    if (!ccSettings || !ccSettings.prompts) return text;

    // Dynamically import ST's native classes for accurate token management
    let ChatCompletion, Message;
    try {
        let oaiModule = await import('../../../openai.js').catch(() => null);
        if (!oaiModule) oaiModule = await import('../../../../openai.js').catch(() => null); // Third-party dir
        if (!oaiModule) oaiModule = await import('../../../scripts/openai.js').catch(() => null);
        if (!oaiModule) oaiModule = await import('../../../../scripts/openai.js').catch(() => null); // Third-party dir
        if (!oaiModule) oaiModule = await import('/scripts/openai.js').catch(() => null);
        
        if (!oaiModule) throw new Error("Could not find openai.js in any known path.");

        ChatCompletion = oaiModule.ChatCompletion;
        Message = oaiModule.Message;

        if (!ChatCompletion || !Message) {
            const ccModule = await import('../../../chat-completion.js').catch(() => null) ||
                             await import('../../../../chat-completion.js').catch(() => null) ||
                             await import('../../../scripts/chat-completion.js').catch(() => null) ||
                             await import('../../../../scripts/chat-completion.js').catch(() => null) ||
                             await import('/scripts/chat-completion.js').catch(() => null);
            ChatCompletion = ChatCompletion || ccModule?.ChatCompletion;

            const msgModule = await import('../../../messages.js').catch(() => null) ||
                              await import('../../../../messages.js').catch(() => null) ||
                              await import('../../../scripts/messages.js').catch(() => null) ||
                              await import('../../../../scripts/messages.js').catch(() => null) ||
                              await import('/scripts/messages.js').catch(() => null);
            Message = Message || msgModule?.Message;
            
            if (!ChatCompletion || !Message) throw new Error("Native ST classes missing from module exports.");
        }
    } catch (err) {
        logger.error('Failed to import native SillyTavern classes. Token-aware trimming will be disabled.', err);
        return text.replace(/\{\{cc_all_prompts(?:\(budget=(\d+)\))?\}\}/g, '(Error: Native ST classes missing. Please check extension installation path.)');
    }

    // Identify prompt order for the current context
    const charData = stContext.characters[stContext.characterId] || {};
    const charId = charData.id || 0;
    const allOrders = ccSettings.prompt_order || [];
    const promptOrderEntry = allOrders.find(e => String(e.character_id) === String(charId)) ||
        allOrders.find(e => String(e.character_id) === '100001') ||
        allOrders.find(e => String(e.character_id) === '100000') ||
        allOrders.find(e => e.character_id === '') ||
        allOrders[0];

    const rawPromptOrder = promptOrderEntry?.order || [];
    const promptOrder = [...rawPromptOrder];

    // Ensure all enabled prompts have an entry in promptOrder
    ccSettings.prompts.forEach(p => {
        if (!promptOrder.some(e => e.identifier === p.identifier)) {
            promptOrder.push({ identifier: p.identifier, enabled: true });
        }
    });

    // Cache World Info for the duration of this macro resolution
    let cachedWI = null;
    const getCachedWI = async (chatSource) => {
        if (!cachedWI) cachedWI = await getWorldInfoForChat(chatSource);
        return cachedWI;
    };

    /**
     * Internal helper to resolve a single identifier's content.
     */
    const resolveIdentifier = async (id, chatSource) => {
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
                case 'worldInfoBefore': {
                    const freshWI = await getCachedWI(chatSource);
                    return wrap(freshWI.before || '');
                }
                case 'worldInfoAfter': {
                    const freshWI = await getCachedWI(chatSource);
                    return wrap(freshWI.after || '');
                }
                case 'dialogueExamples': return wrap(charFields.mesExamples || char?.mes_example || '');
                case 'chatHistory': {
                    return chatSource.map(m => {
                        let mRole = 'assistant';
                        if (m.extra?.polyceph_hidden) mRole = 'assistant';
                        else if (m.is_user) mRole = 'user';
                        else if (m.is_system) mRole = 'system';

                        let encodedInvocations = '';
                        if (m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                            encodedInvocations = `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
                        }

                        return `[[ROLE:${mRole}]]\n${m.mes}${encodedInvocations}\n[[/ROLE]]`;
                    }).join('\n\n');
                }
                default: return wrap(prompt.content || '');
            }
        }
        return wrap(prompt.content || '');
    };

    let result = text;

    // 1. Resolve {{cc_all_prompts}} with token-aware trimming
    const allPromptsMatch = result.match(/\{\{cc_all_prompts\}\}/);
    if (allPromptsMatch) {
        // Initialize Native ST ChatCompletion to manage budget
        const chatCompletion = new ChatCompletion();
        const maxContext = getMaxContextTokens();
        const maxResponse = getMaxResponseTokens();
        chatCompletion.setTokenBudget(maxContext, maxResponse);

        // Calculate Static Overhead: pipeline prompt + other CC prompts
        // We resolve standard macros in the template first to get accurate overhead
        let shadowPrompt = result.replace(/\{\{cc_all_prompts\}\}/g, '');
        if (typeof stContext.substituteParams === 'function') {
            shadowPrompt = stContext.substituteParams(shadowPrompt, {
                dynamicMacros: contextVault
            });
        }

        const shadowTokens = await countTokens(shadowPrompt);
        chatCompletion.reserveBudget(shadowTokens);

        // Reserve budget for other static CC prompts
        const staticCCParts = [];
        for (const entry of promptOrder) {
            if (!entry.enabled || entry.identifier === 'chatHistory') continue;
            const content = resolveIdentifier(entry.identifier, []);
            if (content.trim()) {
                const msg = await Message.createAsync('system', content, entry.identifier);
                if (chatCompletion.canAfford(msg)) {
                    chatCompletion.add(msg);
                    staticCCParts.push(content);
                }
            }
        }

        // Determine final history budget
        let historyBudget = chatCompletion.tokenBudget - 100; // 100 token safety margin

        // Trim History using native canAfford logic
        const trimmedChat = [];
        if (historyBudget > 0) {
            let currentHistoryTokens = 0;
            for (let i = cleanChat.length - 1; i >= 0; i--) {
                const m = cleanChat[i];
                const role = m.is_user ? 'user' : 'assistant';
                // Estimate with 8 token message overhead
                const msg = await Message.createAsync(role, m.mes, `chatHistory-${i}`);
                if (currentHistoryTokens + msg.getTokens() + 8 > historyBudget) break;

                trimmedChat.unshift(m);
                currentHistoryTokens += msg.getTokens() + 8;
            }
        }

        // Final Assembly
        const allPrompts = [];
        for (const entry of promptOrder) {
            if (!entry.enabled) continue;
            const content = await resolveIdentifier(entry.identifier, trimmedChat);
            if (content.trim()) allPrompts.push(content.trim());
        }

        logger.debug(`CC Macro Resolution - Budget: ${historyBudget}, Overhead: ${shadowTokens}, Context: ${maxContext}`);

        const combined = allPrompts.join('\n\n');
        result = result.replace(/\{\{cc_all_prompts\}\}/g, combined);
    }

    // 2. Resolve {{world_info}} and {{wi}} macros (dynamic, no trimming)
    const wiRegex = /\{\{(world_info|wi)(?:\|(before|after))?\}\}/gi;
    let wiMatch;
    while ((wiMatch = wiRegex.exec(result)) !== null) {
        const fullMatch = wiMatch[0];
        const part = wiMatch[2];
        const freshWI = await getCachedWI(cleanChat);
        let replacement = '';
        if (part === 'before') replacement = freshWI.before;
        else if (part === 'after') replacement = freshWI.after;
        else replacement = freshWI.worldInfoString;
        
        result = result.replace(fullMatch, replacement);
        wiRegex.lastIndex = 0; // Reset because we modified result
    }

    // 3. Resolve individual macros (no trimming for specific requests)
    if (result.includes('{{cc_main_prompt}}')) result = result.replace(/\{\{cc_main_prompt\}\}/g, await resolveIdentifier('main', cleanChat));
    if (result.includes('{{cc_aux_prompt}}')) {
        const content = await resolveIdentifier('nsfw', cleanChat);
        result = result.replace(/\{\{cc_aux_prompt\}\}/g, content);
    }
    if (result.includes('{{cc_nsfw_prompt}}')) {
        const content = await resolveIdentifier('nsfw', cleanChat);
        result = result.replace(/\{\{cc_nsfw_prompt\}\}/g, content);
    }
    if (result.includes('{{cc_post_history_instructions}}')) {
        const content = await resolveIdentifier('jailbreak', cleanChat);
        result = result.replace(/\{\{cc_post_history_instructions\}\}/g, content);
    }
    if (result.includes('{{cc_jailbreak_prompt}}')) {
        const content = await resolveIdentifier('jailbreak', cleanChat);
        result = result.replace(/\{\{cc_jailbreak_prompt\}\}/g, content);
    }
    if (result.includes('{{cc_enhance_definitions}}')) {
        const content = await resolveIdentifier('enhanceDefinitions', cleanChat);
        result = result.replace(/\{\{cc_enhance_definitions\}\}/g, content);
    }

    return result;
}

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
    result = resolveChatHistory(result, cleanChat, stContext);

    // 3. Resolve Chat Completion Prompts (Token-aware)
    result = await resolveCCMacros(result, cleanChat, stContext, null, contextVault);

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
