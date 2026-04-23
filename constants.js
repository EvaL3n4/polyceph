export const MODULE_NAME = 'polyceph';
export const VERSION = '0.2.0';

export const defaultSettings = {
    enabled: false,
    delayMs: 250,
    persistThoughts: false,
    steps: [
        {
            id: 'step_1',
            label: '',
            persist: false,
            cleanPersist: false,
            nodes: [
                { id: 'node_1', label: '', profile: 'none', useSystem: false, template: '{{user_input}}' }
            ]
        }
    ]
};
