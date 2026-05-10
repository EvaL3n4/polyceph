import { stopPipeline } from '../../../../engine.js';
import { scrollToBottomIfNear } from '../../../ui-shared.js';
import { settings } from '../../../../state.js';
import { logger } from '../../../../logger.js';

/**
 * Renders the Polyceph typing indicator inside a message block.
 */
export function renderPolycephTyping(messageElement, chatMsg) {
    const activeTasks = chatMsg.extra?.polyceph_active_tasks || [];
    const isStopping = chatMsg.extra?.polyceph_stopping === true;
    const isWaitingOnExtensions = activeTasks.length > 0 && activeTasks.every(t => 
        t.id === 'waiting' || 
        t.status === 'waiting' || 
        t.status === 'waiting_on_extensions'
    );

    let stepInfo = 'Processing';
    if (isWaitingOnExtensions) {
        stepInfo = 'Waiting for Extensions';
    } else if (activeTasks.length > 0) {
        const firstTask = activeTasks[0];
        stepInfo = `Step ${firstTask.step}/${firstTask.totalSteps}`;
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
                        <span class="polyceph-typing-icon fa-solid fa-spinner fa-spin"></span>
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
        $indicator.find('.polyceph-typing-icon').removeClass('fa-spinner fa-spin fa-clock').addClass('fa-hourglass-half');
        $indicator.find('.polyceph-stop-button').hide();
    } else {
        $indicator.find('.polyceph-typing-step-label').text(`Polyceph ${stepInfo}`);
        
        // Update Icon based on state
        const $icon = $indicator.find('.polyceph-typing-icon');
        if (isWaitingOnExtensions) {
            $icon.removeClass('fa-spinner fa-spin').addClass('fa-clock');
        } else {
            $icon.removeClass('fa-clock').addClass('fa-spinner fa-spin');
        }

        const tasksHtml = activeTasks.map(task => {
            const statusLabel = (task.status === 'waiting' || task.status === 'waiting_on_extensions') 
                ? '<span class="polyceph-task-status-waiting">(Waiting)</span>' 
                : '';
            
            const recursionLabel = (task.recursion > 1)
                ? `<span class="polyceph-task-recursion-tag">(Recursion ${task.recursion})</span>`
                : '';
            
            return `
                <div class="polyceph-active-task ${task.status === 'waiting' || task.status === 'waiting_on_extensions' ? 'polyceph-task-waiting' : ''}">
                    <div class="polyceph-active-task-label">${task.label} ${recursionLabel} ${statusLabel}</div>
                    <div class="polyceph-active-task-profile">${task.profile}</div>
                </div>
            `;
        }).join('');
        
        $indicator.find('.polyceph-active-tasks-list').html(tasksHtml || '<div class="polyceph-active-task-label">Preparing...</div>');
        $indicator.find('.polyceph-stop-button').show();

        if (!isSticky) {
            scrollToBottomIfNear();
        }
    }
}
