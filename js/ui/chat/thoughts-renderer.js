import { logger } from '../../logger.js';
import { stopPipeline } from '../../engine.js';
import { scrollToBottom, scrollToBottomIfNear } from '../ui-shared.js';
import { settings } from '../../state.js';

/**
 * Generates HTML for a single reasoning thought block.
 */
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

/**
 * Generates the full HTML container for a list of thoughts.
 */
export function generateThoughtsHTML(thoughtsArray, pipelineName) {
    if (!thoughtsArray || thoughtsArray.length === 0) return '';

    const thoughtsId = `polyceph_thoughts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const htmlBlocks = thoughtsArray.map(t => generateSingleThoughtHTML(t)).join('\n<div class="polyceph-thought-separator"></div>\n');

    return `<div id="${thoughtsId}" class="polyceph-thoughts">
        <div class="polyceph-thoughts-details">
            <div class="polyceph-thought-summary">
                <div class="polyceph-thought-summary-container" onclick="this.parentElement.parentElement.classList.toggle('polyceph-thoughts-open');">
                    <div class="polyceph-thought-summary-title">
                        <b>Reasoning</b>
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

/**
 * Renders the Polyceph typing indicator inside a message block.
 */
export function renderPolycephTyping(messageElement, chatMsg) {
    const activeTasks = chatMsg.extra?.polyceph_active_tasks || [];
    const isStopping = chatMsg.extra?.polyceph_stopping === true;

    let stepInfo = 'Processing';
    if (activeTasks.length > 0) {
        const firstTask = activeTasks[0];
        if (firstTask.id === 'waiting') {
            stepInfo = 'Preparing';
        } else {
            stepInfo = `Step ${firstTask.step}/${firstTask.totalSteps}`;
        }
    } else if (chatMsg.mes && chatMsg.mes.includes('Step')) {
        const match = chatMsg.mes.match(/Step (\d+\/\d+)/);
        if (match) stepInfo = `Step ${match[1]}`;
    }

    const $mesBlock = $(messageElement).find('.mes_block');
    messageElement.setAttribute('polyceph_typing', 'true');

    const isSticky = settings.stickyTypingIndicator;
    let $indicator;

    if (isSticky) {
        let $container = $('#polyceph-sticky-container');
        if ($container.length === 0) $container = $('<div id="polyceph-sticky-container"></div>').appendTo('body');
        $indicator = $container.find('.polyceph-typing-indicator');
        // If it was inline, remove it
        $mesBlock.find('.polyceph-typing-indicator').remove();
    } else {
        $indicator = $mesBlock.find('.polyceph-typing-indicator');
        // If it was sticky, remove it
        $('#polyceph-sticky-container .polyceph-typing-indicator').remove();
    }

    if ($indicator.length === 0) {
        $indicator = $(`
            <div class="polyceph-typing-indicator ${isSticky ? 'polyceph-sticky' : ''}">
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

        if (isSticky) {
            $('#polyceph-sticky-container').append($indicator);
        } else {
            $mesBlock.append($indicator);
            scrollToBottomIfNear();
        }
    }

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
        
        if (!isSticky) {
            scrollToBottomIfNear();
        }
    }
}

/**
 * Main loop to render thoughts and backgrounds for all messages in the chat.
 */
export function renderPolycephThoughts() {
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    $('#chat .mes').each((_, messageElement) => {
        const mesId = messageElement.getAttribute('mesid');
        const chatMsg = context.chat[mesId];
        if (!chatMsg) return;

        // 1. Handle Typing Indicator
        const isTyping = (chatMsg.extra && chatMsg.extra.polyceph_typing);
        if (isTyping) {
            renderPolycephTyping(messageElement, chatMsg);
            return;
        } else {
            $(messageElement).find('.polyceph-typing-indicator').remove();
            if (settings.stickyTypingIndicator) {
                $('#polyceph-sticky-container .polyceph-typing-indicator').remove();
            }
            messageElement.removeAttribute('polyceph_typing');
        }

        // 2. Handle Hidden Background Messages
        if ((chatMsg.extra && chatMsg.extra.polyceph_hidden) || chatMsg.name === 'Background') {
            messageElement.setAttribute('polyceph_hidden', 'true');
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

        // 3. Handle Reasoning/Thoughts Blocks
        const lastRenderedSwipe = messageElement.getAttribute('polyceph_thoughts_swipe');
        const currentSwipeId = String(chatMsg.swipe_id ?? 0);
        const existingThoughtsId = messageElement.getAttribute('polyceph_thoughts_id');
        const thoughtsExistInDOM = existingThoughtsId && document.getElementById(existingThoughtsId);

        if (lastRenderedSwipe === currentSwipeId && thoughtsExistInDOM) return;

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

        if (existingThoughtsId) {
            $(`#${existingThoughtsId}`).remove();
            messageElement.removeAttribute('polyceph_thoughts_id');
        }

        messageElement.setAttribute('polyceph_thoughts_swipe', currentSwipeId);

        if (!thoughts || thoughts.length === 0) return;

        const thoughtsHtml = generateThoughtsHTML(thoughts, pipelineName);
        const $thoughtsContainer = $(thoughtsHtml);
        const thoughtsId = $thoughtsContainer.attr('id');

        const $mesTracker = $(messageElement).find('.mes_tracker').first();
        const $mesText = $(messageElement).find('.mes_text').first();

        if ($mesTracker.length > 0) $mesTracker.before($thoughtsContainer);
        else if ($mesText.length > 0) $mesText.before($thoughtsContainer);
        else $(messageElement).append($thoughtsContainer);

        messageElement.setAttribute('polyceph_thoughts_id', thoughtsId);
    });

    // Defer a final scroll to ensure all injected elements are sized
    setTimeout(() => scrollToBottomIfNear(), 50);
}
