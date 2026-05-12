import { getPopupModule } from '../../../compat-st.js';

export let activeStepIndex = 0;
export let lastPipelineId = null;
export let Popup = null;

(async () => {
    const popupModule = await getPopupModule();
    if (popupModule) Popup = popupModule.Popup;
})();

export function setActiveStepIndex(index) {
    activeStepIndex = index;
}

export function setLastPipelineId(id) {
    lastPipelineId = id;
}
