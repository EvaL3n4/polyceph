import { logger } from '../../../logger.js';
import { scrollToBottomIfNear } from '../../ui-shared.js';
import { settings } from '../../../state.js';
import { renderPolycephTyping } from './renderers/typing.js';
import { generateThoughtsHTML } from './renderers/thoughts-container.js';
import { generateSingleThoughtHTML } from './renderers/single-thought.js';

export { renderPolycephTyping, generateThoughtsHTML, generateSingleThoughtHTML };

/**
 * Main loop to render thoughts and backgrounds for all messages in the chat.
 */
export function renderPolycephThoughts(force = false) {
    if (force) console.log('[Polyceph] Force rerender of thoughts triggered.');
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    // 0. Global Typing State Check
    const anyTyping = context.chat.some(m => m && m.extra && m.extra.polyceph_typing);
    if (!anyTyping || !settings.stickyTypingIndicator) {
        $('#polyceph-sticky-container .polyceph-typing-indicator').remove();
    }

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
            // Only remove inline indicators here; sticky is handled globally
            $(messageElement).find('.polyceph-typing-indicator').remove();
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

        if (!force && lastRenderedSwipe === currentSwipeId && thoughtsExistInDOM) {
            return;
        }

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

        if (!thoughts || thoughts.length === 0) {
            if (chatMsg.extra?.polyceph_thoughts || swipeEntry?.extra?.polyceph_thoughts) {
                logger.warn(`Message ${mesId} has thoughts metadata but they are empty/null.`, { thoughts });
            }
            return;
        }

        logger.debug(`Rendering thoughts for message ${mesId}. Count: ${thoughts.length}`);

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
