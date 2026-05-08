import { stopPipeline } from '../../../../engine.js';
import { scrollToBottomIfNear } from '../../../ui-shared.js';
import { settings } from '../../../../state.js';

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
