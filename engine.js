import { MODULE_NAME } from './constants.js';
import { settings, switchProfile } from './state.js';
import { generateId } from './utils.js';

export async function generateQuietly(profileName, prompt, useSystem) {
    if (!profileName || profileName === 'none') return prompt;

    try {
        const context = SillyTavern.getContext();

        let responseData = "";

        let apiPromise;

        if (useSystem && typeof context.generateQuietPrompt === 'function') {
            apiPromise = context.generateQuietPrompt({ quietPrompt: prompt });
        } else if (!useSystem && typeof context.generateRaw === 'function') {
            apiPromise = context.generateRaw({ prompt: prompt, systemPrompt: '' });
        } else if (typeof context.generateQuietPrompt === 'function') {
            console.warn(`[${MODULE_NAME}] generateRaw not found, falling back to generateQuietPrompt.`);
            apiPromise = context.generateQuietPrompt({ quietPrompt: prompt });
        } else {
            console.warn(`[${MODULE_NAME}] generateQuietPrompt not found, falling back to basic command execution.`);
            // Fallback for older ST versions
            const escaped = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            apiPromise = context.executeSlashCommandsWithOptions(`/gen ${escaped}`, {
                handleExecutionErrors: false, handleParserErrors: false
            });
        }

        const timeoutMs = settings.generationTimeoutMs !== undefined ? settings.generationTimeoutMs : 60000;

        if (timeoutMs > 0) {
            responseData = await Promise.race([
                apiPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Generation Timeout')), timeoutMs))
            ]);
        } else {
            responseData = await apiPromise;
        }

        if (responseData) return responseData;
        return "(Generation returned empty)";
    } catch (err) {
        console.error(`[${MODULE_NAME}] generation failed:`, err);
        return "(Error during generation)";
    }
}

async function startTypingIndicator() {
    const context = SillyTavern.getContext();
    const charName = context.characters?.[context.characterId]?.name || context.name2 || 'Assistant';
    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.characters?.[context.characterId] ?
        context.getThumbnailUrl('avatar', context.characters[context.characterId].avatar) : '';

    const typingMsg = {
        name: charName,
        is_user: false,
        is_system: false,
        send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
        mes: '...',
        force_avatar: avatarStr,
        extra: { polyceph_typing: true }
    };
    context.chat.push(typingMsg);
    if (context.eventSource && context.eventTypes) {
        await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, context.chat.length - 1);
    }
    if (typeof context.addOneMessage === 'function') context.addOneMessage(typingMsg);
}

async function ensureTypingIndicatorAtEnd() {
    const context = SillyTavern.getContext();
    const idx = context.chat.findIndex(m => m.extra && m.extra.polyceph_typing);
    if (idx === -1) return;

    if (idx === context.chat.length - 1) return;

    const msg = context.chat.splice(idx, 1)[0];
    context.chat.push(msg);

    if (typeof context.renderChat === 'function') await context.renderChat();
}

async function removeTypingIndicator() {
    const context = SillyTavern.getContext();
    const idx = context.chat.findIndex(m => m.extra && m.extra.polyceph_typing);
    if (idx === -1) return;

    context.chat.splice(idx, 1);
    if (typeof context.renderChat === 'function') await context.renderChat();
    // No saveChat here to avoid persisting the removal alone if not needed, 
    // although it's safer to just do it.
    if (typeof context.saveChat === 'function') context.saveChat();
}

export async function runPipeline(userInput, generateSwipesForBatchId) {
    //toastr.info('Starting Polyceph Pipeline...', 'Polyceph');
    const contextVault = { 
        'user_input': userInput,
        'input': userInput 
    };
    const batchId = generateSwipesForBatchId || 'batch_' + generateId();
    const stContext = SillyTavern.getContext();
    
    // Fetch World Info prompt (Lorebook)
    // Filter out typing indicator from chat for macro resolution to avoid '...' in history
    const cleanChat = stContext.chat.filter(m => !m.extra?.polyceph_typing);
    const wiPrompt = await stContext.getWorldInfoPrompt(cleanChat, stContext.maxContext, false);
    contextVault['wi'] = wiPrompt;
    contextVault['world_info'] = wiPrompt;
    
    let cleanMessagesArr = [];
    if (generateSwipesForBatchId) {
        cleanMessagesArr = stContext.chat.filter(m => m.extra && m.extra.polyceph_batch === generateSwipesForBatchId);
    }

    await startTypingIndicator();

    try {
        for (let i = 0; i < settings.steps.length; i++) {
            const step = settings.steps[i];
            const isLastStep = i === settings.steps.length - 1;

            if (!step.nodes || step.nodes.length === 0) continue;

            // Group nodes by profile to minimize ST global switches and race conditions
            const profileGroups = {};
            step.nodes.forEach((node, nodeIndex) => {
                const pName = node.profile || 'Target';
                if (!profileGroups[pName]) profileGroups[pName] = [];
                profileGroups[pName].push({ node, nodeIndex });
            });

            const resultsByIndex = [];

            // Process each profile group sequentially
            for (const [profileId, groupNodes] of Object.entries(profileGroups)) {
                if (profileId !== 'none') {
                    await switchProfile(profileId);
                    // Allow ST UI state to settle profile load
                    await new Promise(r => setTimeout(r, 250));
                }

                // Process nodes sequentially to strictly respect rate-limiting
                for (let k = 0; k < groupNodes.length; k++) {
                    const item = groupNodes[k];
                    const { node, nodeIndex } = item;
                    let prompt = node.template || '';

                    // Polyceph-specific: {{chat_history}} and {{chat_history:X}}
                    prompt = prompt.replace(/\{\{chat_history(?::(\d+))?\}\}/g, (match, count) => {
                        let history = cleanChat.map(m => `${m.name}: ${m.mes}`);
                        if (count) {
                            const cap = parseInt(count);
                            history = history.slice(-cap);
                        }
                        return history.join('\n\n');
                    });

                    // SillyTavern Standard Macros & Step Variables
                    // This handles {{char}}, {{user}}, {{personality}}, {{wi}}, etc.
                    prompt = stContext.substituteParams(prompt, {
                        dynamicMacros: contextVault
                    });

                    let res = null;
                    const maxAttempts = (settings.maxRetries !== undefined) ? settings.maxRetries : 0;

                    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
                        res = await generateQuietly(node.profile, prompt, !!node.useSystem);

                        const isEmpty = !res || res.trim() === "" || res === "(Generation returned empty)" || res === "(Error during generation)";

                        if (!isEmpty) {
                            break; // Success
                        }

                        if (attempt < maxAttempts) {
                            toastr.warning(`Node failed or returned empty. Retrying (${attempt + 1}/${maxAttempts})...`, 'Polyceph');
                            const delayWait = settings.retryDelayMs !== undefined ? settings.retryDelayMs : 2000;
                            await new Promise(r => setTimeout(r, delayWait));
                        }
                    }

                    const sIdIndx = i + 1;
                    const tIdIndx = nodeIndex + 1;

                    // Assign to vault variants
                    contextVault[`${step.id}_target_${tIdIndx}`] = res;
                    contextVault[`s${sIdIndx}t${tIdIndx}`] = res;
                    if (node.label) {
                        contextVault[node.label.trim()] = res;
                    }

                    if (node.profile === 'none' || step.cleanPersist) {
                        // Keep text completely clean for template-only and cleanPersist nodes
                        resultsByIndex[nodeIndex] = res;
                    } else {
                        // Wrap normally without the gigantic API profile names
                        const targetHeader = node.label ? node.label : `Target ${tIdIndx}`;
                        resultsByIndex[nodeIndex] = `[${targetHeader}]\n${res}`;
                    }

                    // Strict rate limit delay between individual requests
                    if (settings.delayMs && settings.delayMs > 0) {
                        await new Promise(r => setTimeout(r, settings.delayMs));
                    }
                }
            }

            const combinedResult = step.cleanPersist ? resultsByIndex.join('\n\n') : resultsByIndex.join('\n\n---\n\n');
            const sIdIndxOuter = i + 1;

            contextVault[step.id] = combinedResult;
            contextVault[`s${sIdIndxOuter}`] = combinedResult;
            if (step.label) {
                contextVault[step.label.trim()] = combinedResult;
            }

            if (step.persist) {
                const context = SillyTavern.getContext();
                if (step.cleanPersist) {
                    // Send directly into the chat buffer as a character message
                    const charName = context.characters?.[context.characterId]?.name || context.name2 || 'Assistant';
                    const avatarStr = typeof context.getThumbnailUrl === 'function' && context.characters?.[context.characterId] ?
                        context.getThumbnailUrl('avatar', context.characters[context.characterId].avatar) : '';

                    const extraData = { api: 'manual', model: 'polyceph', polyceph_batch: batchId, polyceph_input: userInput, polyceph_step_id: step.id };

                    let targetSwipeId = -1;
                    if (generateSwipesForBatchId) {
                        targetSwipeId = cleanMessagesArr.findIndex(m => m.extra && m.extra.polyceph_step_id === step.id);
                    }

                    if (targetSwipeId !== -1) {
                        const targetMessage = cleanMessagesArr[targetSwipeId];
                        const actualMesId = context.chat.indexOf(targetMessage);

                        if (!Array.isArray(targetMessage.swipes)) {
                            targetMessage.swipes = [targetMessage.mes];
                            targetMessage.swipe_info = [{}];
                            targetMessage.swipe_id = 0;
                        }

                        targetMessage.swipes.push(combinedResult);
                        targetMessage.swipe_id = targetMessage.swipes.length - 1;
                        targetMessage.swipe_info.push({ extra: extraData });
                        targetMessage.mes = combinedResult;

                        if (typeof context.updateMessageBlock === 'function') {
                            context.updateMessageBlock(actualMesId, targetMessage);
                            
                            // Manually update ST swipe UI state
                            const mesBlock = document.querySelector(`.mes[mesid="${actualMesId}"]`);
                            if (mesBlock) {
                                const counter = mesBlock.querySelector('.swipes-counter');
                                if (counter) counter.textContent = `${targetMessage.swipes.length}/${targetMessage.swipes.length}`;
                                
                                const swipeLeft = mesBlock.querySelector('.swipe_left');
                                if (swipeLeft) swipeLeft.style.display = 'flex';
                            }
                        }
                        if (context.eventSource && context.eventTypes) {
                            context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, actualMesId);
                        }
                        if (typeof context.saveChat === 'function') context.saveChat();
                    } else {
                        const message = {
                            name: charName,
                            is_user: false,
                            is_system: false,
                            send_date: typeof context.humanizedDateTime === 'function' ? context.humanizedDateTime() : new Date().toLocaleString(),
                            mes: combinedResult,
                            force_avatar: avatarStr,
                            extra: extraData
                        };
                        context.chat.push(message);
                        if (context.eventSource && context.eventTypes) {
                            await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, context.chat.length - 1);
                        }
                        if (typeof context.addOneMessage === 'function') context.addOneMessage(message);
                        if (context.eventSource && context.eventTypes) {
                            await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, context.chat.length - 1);
                        }
                        if (typeof context.saveChat === 'function') context.saveChat();
                    }
                    await ensureTypingIndicatorAtEnd();
                } else {
                    const stepHeader = step.label ? `[${step.label}]` : `[Polyceph Output: Step ${sIdIndxOuter}]`;
                    await context.executeSlashCommandsWithOptions(`/sys ${stepHeader}\n${combinedResult}`, {
                        handleExecutionErrors: false, handleParserErrors: false
                    });
                }
            }

            if (isLastStep) {
                const stContext = SillyTavern.getContext();
                await stContext.executeSlashCommandsWithOptions(`/echo ${combinedResult}`, {
                    handleExecutionErrors: false, handleParserErrors: false
                });
            }
        }
        //toastr.success('Pipeline finished.', 'Polyceph');
    } catch (e) {
        toastr.error('Pipeline execution encountered an error.', 'Polyceph');
        console.error(`[${MODULE_NAME}] Pipeline Error`, e);
    } finally {
        await removeTypingIndicator();
    }
}
