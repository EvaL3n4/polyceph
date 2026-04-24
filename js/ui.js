import { getActivePipeline } from './state.js';

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

export function renderPolycephThoughts() {
    const context = SillyTavern.getContext();
    if (!context || !context.chat) return;

    $('#chat .mes').each((_, messageElement) => {
        if (messageElement.getAttribute('polyceph_thoughts_rendered') === 'true') return;

        const mesId = messageElement.getAttribute('mesid');
        const chatMsg = context.chat[mesId];
        if (!chatMsg) return;

        let thoughts = null;
        let pipelineName = null;
        if (chatMsg.swipe_info && chatMsg.swipe_id !== undefined && chatMsg.swipe_info[chatMsg.swipe_id]) {
            thoughts = chatMsg.swipe_info[chatMsg.swipe_id]?.extra?.polyceph_thoughts;
            pipelineName = chatMsg.swipe_info[chatMsg.swipe_id]?.extra?.polyceph_pipeline;
        }
        if (!thoughts && chatMsg.extra) {
            thoughts = chatMsg.extra.polyceph_thoughts;
            pipelineName = chatMsg.extra.polyceph_pipeline;
        }

        if (!thoughts || thoughts.length === 0) {
            messageElement.setAttribute('polyceph_thoughts_rendered', 'true');
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

        messageElement.setAttribute('polyceph_thoughts_rendered', 'true');
        messageElement.setAttribute('polyceph_thoughts_id', thoughtsId);

        // Handle Hidden Background Messages
        if (chatMsg.extra && chatMsg.extra.polyceph_hidden) {
            messageElement.setAttribute('polyceph_hidden', 'true');

            // Inject separator if not already there
            if (!messageElement.querySelector('.polyceph-background-separator')) {
                const $separator = $(`
                    <div class="polyceph-background-separator">
                        <div class="polyceph-background-label">Background Message</div>
                    </div>
                `);
                $separator.on('click', () => {
                    messageElement.classList.toggle('polyceph-hidden-open');
                });
                $(messageElement).prepend($separator);
            }
        }

        if (chatMsg.is_system && chatMsg.mes === '') {
            messageElement.style.display = 'none';
        }
    });
}

// Initial state for hidden messages
$(document).ready(() => {
    const { settings } = SillyTavern.getContext();
    if (settings && settings.showHiddenMessages) {
        document.body.classList.add('polyceph-show-hidden');
    }
});
