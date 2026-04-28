import { MODULE_NAME } from './constants.js';
import { getActivePipeline, settings } from './state.js';
import { stopPipeline } from './engine.js';

export function syncHiddenMessageVisibility() {
    if (settings && settings.showHiddenMessages) {
        document.body.classList.add('polyceph-show-hidden');
    } else {
        document.body.classList.remove('polyceph-show-hidden');
    }

    if (settings && settings.showReasoning !== false) {
        document.body.classList.add('polyceph-show-reasoning');
    } else {
        document.body.classList.remove('polyceph-show-reasoning');
    }
}

/**
 * Monitors SillyTavern's deletion mode dialog to toggle a helper class on the body.
 */
export function monitorDeletionMode() {
    const dialog = document.getElementById('dialogue_del_mes');
    if (!dialog) return;

    const observer = new MutationObserver(() => {
        if (dialog.style.display === 'block') {
            document.body.classList.add('polyceph-delete-mode');
        } else {
            document.body.classList.remove('polyceph-delete-mode');
        }
    });

    observer.observe(dialog, { attributes: true, attributeFilter: ['style'] });

    // Initial check
    if (dialog.style.display === 'block') {
        document.body.classList.add('polyceph-delete-mode');
    }
}

export function generateSingleThoughtHTML(t) {
    let contentHtml = t.content;
    const stContext = SillyTavern.getContext();
    if (typeof stContext.messageFormatting === 'function') {
        contentHtml = stContext.messageFormatting(contentHtml, 'Polyceph', false, false);
    } else {
        contentHtml = contentHtml.replace(/\n/g, '<br>');
    }

    const openClass = t.isSilent ? '' : 'polyceph-item-open';
    const silentClass = t.isSilent ? 'polyceph-silent-thought' : '';

    return `<div class="polyceph-generated-thought ${openClass} ${silentClass}">
        <div class="polyceph-generated-thought-name" style="cursor:pointer;" onclick="this.parentElement.classList.toggle('polyceph-item-open');">
            <span class="polyceph-item-toggle-icon">▶</span> ${t.title}
            ${t.profile ? `<span class="polyceph-item-metadata">${t.profile}</span>` : ''}
        </div>
        <div class="polyceph-generated-thought-content">${contentHtml}</div>
    </div>`;
}

export function generateThoughtsHTML(thoughtsArray, pipelineName) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';

    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const htmlBlocks = thoughtsArray.map(t => generateSingleThoughtHTML(t)).join('\n<div class="polyceph-thought-separator"></div>\n');

    return `<div id="${thoughtsId}" class="polyceph-thoughts">
        <div class="polyceph-thoughts-details">
            <div class="polyceph-thought-summary">
                <div class="polyceph-thought-summary-container" onclick="this.parentElement.parentElement.classList.toggle('polyceph-thoughts-open');">
                    <div class="polyceph-thought-summary-title">
                        <b>Polyceph Reasoning</b>
                        ${pipelineName ? `<span class="polyceph-header-metadata">${pipelineName}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="polyceph-thought-items">
                ${htmlBlocks}
            </div>
        </div>
    </div>`;
}

export function renderPolycephTyping(messageElement, chatMsg) {
    const activeTasks = chatMsg.extra?.polyceph_active_tasks || [];
    const isStopping = chatMsg.extra?.polyceph_stopping === true;

    let stepInfo = 'Processing';
    if (activeTasks.length > 0) {
        stepInfo = `Step ${activeTasks[0].step}/${activeTasks[0].totalSteps}`;
    } else if (chatMsg.mes && chatMsg.mes.includes('Step')) {
        // Fallback to text if metadata missing but text has step info
        const match = chatMsg.mes.match(/Step (\d+\/\d+)/);
        if (match) stepInfo = `Step ${match[1]}`;
    }

    const $mesBlock = $(messageElement).find('.mes_block');
    messageElement.setAttribute('polyceph_typing', 'true');

    // Check if we already have an indicator to avoid flicker, just update tasks
    let $indicator = $mesBlock.find('.polyceph-typing-indicator');
    if ($indicator.length === 0) {
        $indicator = $(`
            <div class="polyceph-typing-indicator">
                <div class="polyceph-typing-header">
                    <div class="polyceph-typing-title">
                        <span class="fa-solid fa-spinner fa-spin"></span>
                        <span class="polyceph-typing-step-label">Polyceph ${stepInfo}</span>
                    </div>
                    <div class="polyceph-stop-button" title="Stop Pipeline">
                        <span class="fa-solid fa-square"></span>
                    </div>
                </div>
                <div class="polyceph-active-tasks-list"></div>
            </div>
        `);
        $indicator.find('.polyceph-stop-button').on('click', (e) => {
            e.stopPropagation();
            stopPipeline();
        });
        $mesBlock.append($indicator);
    }

    // Update state-dependent content
    if (isStopping) {
        $indicator.find('.polyceph-typing-step-label').text(`Polyceph Stopping...`);
        $indicator.find('.polyceph-active-tasks-list').html('<div class="polyceph-active-task-label">Cleaning up tasks...</div>');
        $indicator.find('.fa-spinner').removeClass('fa-spinner fa-spin').addClass('fa-hourglass-half');
        $indicator.find('.polyceph-stop-button').hide();
    } else {
        $indicator.find('.polyceph-typing-step-label').text(`Polyceph ${stepInfo}`);
        const tasksHtml = activeTasks.map(task => `
            <div class="polyceph-active-task">
                <div class="polyceph-active-task-label">${task.label}</div>
                <div class="polyceph-active-task-profile">${task.profile}</div>
            </div>
        `).join('');
        $indicator.find('.polyceph-active-tasks-list').html(tasksHtml || '<div class="polyceph-active-task-label">Preparing...</div>');
        $indicator.find('.polyceph-stop-button').show();
    }
}

export function renderPolycephThoughts() {
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    $('#chat .mes').each((_, messageElement) => {


        const mesId = messageElement.getAttribute('mesid');
        const chatMsg = context.chat[mesId];
        if (!chatMsg) return;

        // Handle Typing Indicator
        const isTyping = (chatMsg.extra && chatMsg.extra.polyceph_typing) || (chatMsg.mes === '...' && !chatMsg.is_user && !chatMsg.is_system);
        if (isTyping) {
            renderPolycephTyping(messageElement, chatMsg);
            return;
        } else {
            $(messageElement).find('.polyceph-typing-indicator').remove();
            messageElement.removeAttribute('polyceph_typing');
        }

        // Handle Hidden Background Messages
        if ((chatMsg.extra && chatMsg.extra.polyceph_hidden) || chatMsg.name === 'Background') {
            messageElement.setAttribute('polyceph_hidden', 'true');

            // Inject separator if not already there
            if (messageElement.getAttribute('polyceph_separator_rendered') !== 'true' && !messageElement.querySelector('.polyceph-background-separator')) {
                const $separator = $(`
                    <div class="polyceph-background-separator">
                        <div class="polyceph-background-label">Background Message</div>
                        <div class="polyceph-background-delete fa-solid fa-trash-can" title="Delete message"></div>
                    </div>
                `);
                $separator.on('click', (e) => {
                    const isDelete = e.target.classList.contains('polyceph-background-delete');
                    if (isDelete) {
                        e.stopPropagation();
                        const mesId = messageElement.getAttribute('mesid');
                        const context = SillyTavern.getContext();

                        // Close any open editors or menus to prevent ST from crashing on stale message indices
                        if (typeof context.closeMessageEditor === 'function') context.closeMessageEditor();
                        if (typeof context.hideMenu === 'function') context.hideMenu();

                        if (typeof context.deleteMessage === 'function') {
                            context.deleteMessage(mesId, undefined, true);
                        }
                        return;
                    }
                    messageElement.classList.toggle('polyceph-hidden-open');
                });
                $(messageElement).prepend($separator);
                messageElement.setAttribute('polyceph_separator_rendered', 'true');
            }
        }

        if (chatMsg.is_system && chatMsg.mes === '') {
            messageElement.style.display = 'none';
        }

        // Track which swipe index was last rendered so we can re-render when swipe changes
        const lastRenderedSwipe = messageElement.getAttribute('polyceph_thoughts_swipe');
        const currentSwipeId = String(chatMsg.swipe_id ?? 0);
        if (lastRenderedSwipe === currentSwipeId) return;

        let thoughts = null;
        let pipelineName = null;
        const swipeEntry = chatMsg.swipe_info?.[chatMsg.swipe_id];
        if (swipeEntry) {
            thoughts = swipeEntry.extra?.polyceph_thoughts || null;
            pipelineName = swipeEntry.extra?.polyceph_pipeline || null;
        } else if (chatMsg.extra) {
            thoughts = chatMsg.extra.polyceph_thoughts || null;
            pipelineName = chatMsg.extra.polyceph_pipeline || null;
        }

        // Remove any existing thoughts block before re-rendering
        const existingThoughtsId = messageElement.getAttribute('polyceph_thoughts_id');
        if (existingThoughtsId) {
            $(`#${existingThoughtsId}`).remove();
            messageElement.removeAttribute('polyceph_thoughts_id');
        }

        // Record that we've rendered for this swipe (even if empty, to avoid loops)
        messageElement.setAttribute('polyceph_thoughts_swipe', currentSwipeId);

        if (!thoughts || thoughts.length === 0) {
            return;
        }

        const thoughtsHtml = generateThoughtsHTML(thoughts, pipelineName);
        const $thoughtsContainer = $(thoughtsHtml);
        const thoughtsId = $thoughtsContainer.attr('id');

        const $mesText = $(messageElement).find('.mes_text').first();
        if ($mesText.length > 0) {
            $mesText.before($thoughtsContainer);
        } else {
            $(messageElement).append($thoughtsContainer);
        }

        messageElement.setAttribute('polyceph_thoughts_id', thoughtsId);
    });
}

// Watch for chat changes and initial load
$(document).ready(() => {
    syncHiddenMessageVisibility();
    monitorDeletionMode();

    // Proactive rendering using MutationObserver
    const observer = new MutationObserver((mutations) => {
        let shouldRender = false;
        for (const mutation of mutations) {
            const target = mutation.target;

            // Ignore mutations within Polyceph's own UI elements to prevent infinite loops
            if (target.closest && target.closest('.polyceph-typing-indicator, .polyceph-thoughts, .polyceph-background-separator')) {
                continue;
            }

            // If the mutation target is a message or inside a message
            if (target.nodeType === 1 && (target.classList.contains('mes') || target.closest('.mes'))) {
                shouldRender = true;
                break;
            }
            // If nodes were added, check if they are messages
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && (node.classList.contains('mes') || node.querySelector('.mes'))) {
                    shouldRender = true;
                    break;
                }
            }
            if (shouldRender) break;
        }
        if (shouldRender) {
            // Defer until after ST has completed all swipe-related updates (both DOM and data)
            setTimeout(() => renderPolycephThoughts(), 0);
        }
    });

    const chat = document.getElementById('chat');
    if (chat) {
        observer.observe(chat, { childList: true, subtree: true });
    }
});
