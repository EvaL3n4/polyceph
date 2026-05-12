/**
 * Polyceph Syntax Definitions
 * The single source of truth for all roles, macros, and internal tags.
 */

export const ROLES = ['system', 'user', 'assistant', 'tool'];

export const SPECIAL_MACROS = [
    'user_input',
    'chat_history',
    'polyceph_prompt',
    'cc_all_prompts',
    'cc_main_prompt',
    'cc_aux_prompt',
    'cc_post_history_instructions',
    'cc_enhance_definitions',
    'system_prompt',
    'wi',
    'world_info',
    's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9' // Step outputs
];

export const INTERNAL_TAGS = ['think', 'ramble', 'background'];

/**
 * Checks if a macro name is a Polyceph special macro.
 * @param {string} name 
 * @returns {boolean}
 */
export function isSpecialMacro(name) {
    if (!name) return false;
    const cleanName = name.split('|')[0].trim().toLowerCase();
    return SPECIAL_MACROS.includes(cleanName);
}

/**
 * Checks if a role name is supported.
 * @param {string} role 
 * @returns {boolean}
 */
export function isSupportedRole(role) {
    if (!role) return false;
    return ROLES.includes(role.toLowerCase());
}
