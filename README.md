# Polyceph

An extension for SillyTavern which allows multi-step chain-of-thought/multi-agent response generation.

## Overview
Polyceph enables users to define complex, graph-like execution sequences for AI generation. With it, a single user input can be sent to multiple models simultaneously, combined through custom templates, and passed consecutively across different API profiles to achieve deep chain-of-thought processing entirely behind the scenes.

## Installation
1. Locate your SillyTavern installation directory.
2. Navigate to the extensions folder: `public/scripts/extensions`.
3. Clone or copy this repository folder into the extensions directory (e.g., `public/scripts/extensions/polyceph`).
4. Reload the SillyTavern web interface.

## Usage
1. Open the Extensions Menu (the puzzle piece icon) within SillyTavern.
2. Locate the **Polyceph Pipeline** panel and expand it.
3. Click **Add Pipeline Step** to begin constructing your sequence.

### Configuring Steps
For each pipeline Step, you can define:
- **Target Profiles**: The SillyTavern API connection profiles to query. If you add multiple profiles to a single step, they will be executed *in parallel* simultaneously and their outputs merged.
- **Input Template**: The text prompt sent to the models. You can use dynamic template variables to map contexts:
  - `{{user_input}}`: Inserts the original message you submitted to ST.
  - `{{step_x}}` (e.g., `{{step_1}}` or `{{step_2}}`...): Inserts the combined output result generated from a previous Step in the list.
  - `{{step_x_target_y}}` (e.g., `{{step_1_target_1}}`, `{{step_1_target_2}}`...): Inserts the individual isolated output of a specific Target Node from a previous Step, if you do not want the combined result.
- **Persist output**: If enabled, the results of this step will be injected into your visible chat history as a "System Note" so you can visually verify the intermediate reasoning. If visually unchecked, the data only exists in memory to be passed down the pipeline.

### Running the Extension
Once your pipeline steps are built, toggle on the **Enable Polyceph Pipeline Interception** checkbox at the top of the settings panel.

When enabled, simply type your message into the main SillyTavern text box and hit "Send". Polyceph will intercept the input, pass it through your custom pipeline, and push the final terminus output directly into the chat!