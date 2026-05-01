import { countTokens, getMaxContextTokens, getMaxResponseTokens, getWorldInfoForChat } from '../compat-shared.js';
import { logger, wrapRole } from './utils.js';
import { weaveInjections } from './history.js';

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
        const promptMapping = {
            'summary': '1_memory',
            'authorsNote': '2_floating_prompt',
            'vectorsMemory': '3_vectors',
            'vectorsDataBank': '4_vectors_data_bank',
            'smartContext': 'chromadb'
        };

        let prompt = ccSettings.prompts.find(p => p.identifier === id);
        const extKey = promptMapping[id] || id;
        const extPrompt = stContext.extensionPrompts?.[extKey];

        // If it's an extension prompt not defined in CC prompts, create a virtual one
        if (!prompt && extPrompt) {
            prompt = {
                identifier: id,
                role: extPrompt.role === 1 ? 'user' : (extPrompt.role === 2 ? 'assistant' : 'system'),
                content: extPrompt.value,
                marker: false
            };
        }

        if (!prompt) return '';

        if (prompt.marker || [
            'charDescription', 'charPersonality', 'scenario',
            'personaDescription', 'worldInfoBefore', 'worldInfoAfter',
            'dialogueExamples', 'chatHistory'
        ].includes(id)) {
            const char = stContext.characters[stContext.characterId];
            const charFields = typeof stContext.getCharacterCardFields === 'function' ? stContext.getCharacterCardFields() : {};

            switch (id) {
                case 'charDescription': return wrapRole(prompt.role || 'system', charFields.description || char?.description || '');
                case 'charPersonality': return wrapRole(prompt.role || 'system', charFields.personality || char?.personality || '');
                case 'scenario': return wrapRole(prompt.role || 'system', charFields.scenario || char?.scenario || '');
                case 'personaDescription': {
                    const desc = charFields.persona || stContext.powerUserSettings?.persona_description || '';
                    return wrapRole(prompt.role || 'system', desc);
                }
                case 'worldInfoBefore': {
                    const freshWI = await getCachedWI(chatSource);
                    return wrapRole(prompt.role || 'system', freshWI.before || '');
                }
                case 'worldInfoAfter': {
                    const freshWI = await getCachedWI(chatSource);
                    return wrapRole(prompt.role || 'system', freshWI.after || '');
                }
                case 'dialogueExamples': return wrapRole(prompt.role || 'system', charFields.mesExamples || char?.mes_example || '');
                case 'chatHistory': {
                    const finalMessages = weaveInjections(chatSource, stContext.extensionPrompts);
                    return finalMessages.map(m => {
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
                        if (!m.is_injection && m.extra?.tool_invocations && Array.isArray(m.extra.tool_invocations)) {
                            encodedInvocations = `\n[[INVOCATIONS:${JSON.stringify(m.extra.tool_invocations)}]]`;
                        }

                        return `[[ROLE:${mRole}]]\n${m.mes || ''}${encodedInvocations}\n[[/ROLE]]`;
                    }).join('\n\n');
                }
                default: return wrapRole(prompt.role || 'system', prompt.content || '');
            }
        }
        return wrapRole(prompt.role || 'system', prompt.content || '');
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
            const content = await resolveIdentifier(entry.identifier, []);
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
