# Polyceph

A multi-model orchestration extension for SillyTavern. Define complex, user-governed reasoning pipelines that allow a single user message to trigger a multi-step, multi-connection response generation process.

## The Problem

Standard AI interaction is linear: you send a prompt, and a single model responds. This limits you to the strengths (and weaknesses) of a single API connection:
- You can't have a smarter model "plan" a response before a creative model writes it, or a more attentive model gather information before a smarter model considers the implications.
- You can't cross-reference multiple models to reduce hallucinations or "consensus" check.
- You can't perform intermediate summaries or data extraction during the generation flow.

## The Solution

**Polyceph** (meaning "many-headed") allows you to construct **Pipelines**. A single message from you can trigger an asynchronous, multi-step series of tasks. Models can critique their own work, summarize chat history, or anything you can write a prompt for - delivering responses into your chat at any point you choose during the reasoning chain. You can also create multiple pipelines, easily switching between them to use the best one for your message.

## Features

- **Multi-Step Pipelines**: Chain multiple LLM calls and output collection templates together in sequential steps.
- **Parallel Tasking**: Run multiple models simultaneously within a single step to gather diverse perspectives.
- **In-Chat Selector**: Switch between logic pipelines or bypass Polyceph entirely directly from the chat input bar.
- **Custom Macros**: Use the output of any previous step or task in subsequent prompts using `{{handlebars}}` placeholders/macros.
- **Silent Reasoning**: Optionally show pipeline tasks blocks in a dedicated, collapsible "Reasoning" UI element.
- **Native Swipe Support**: Swiping a Polyceph message reruns the entire pipeline batch, keeping all multi-step results in sync.

## Installation

### Via SillyTavern Extension Installer (Recommended)

1. Open SillyTavern.
2. Go to **Extensions** (puzzle icon) → **Install Extension**.
3. Paste this repository URL: `https://github.com/nialyn-mid/polyceph`
4. Click **Install**.
5. Refresh the page.

### Manual Installation

1. Navigate to your SillyTavern installation's `public/scripts/extensions` folder.
2. Clone this repository or download the ZIP into a folder named `polyceph`.
3. Restart SillyTavern or refresh your browser.

## Setup Guide

### Step 1: Configure Connection Profiles
Polyceph leverages SillyTavern's built-in **Connection Profiles**. 
1. Open the **API Connections** menu (plug icon).
2. Configure a model and click **Save** in the Connection Profiles section.
3. Repeat for each model you want to use in your pipelines.

### Step 2: Build a Pipeline
1. Open the **Extensions** menu (puzzle icon) and select **Polyceph**.
2. Create a new Pipeline and add **Steps**.
3. Add **Tasks** to each step. Assign a **Connection Profile** and write a **Prompt Template** for each task.
4. Choose options such as "Pre-message" to show the user the prompt response as reasoning, or "Character Message" to display the result as the character.

### Step 3: Use in Chat
1. Locate the **Pipeline Selector** (☍ icon) next to the chat send button.
2. Select your desired pipeline (or "None" to chat normally).
3. Type a message and hit send!

## Macro & Placeholder Reference

Route data between tasks using these dynamic tags:
- `{{user_input}}`: The original text from the chat box.
- `{{chat_history:N}}`: The last **N** messages of the chat (Name: Message).
- `{{s1}}`, `{{s2}}`: The combined output of all tasks in a previous Step.
- `{{TaskLabel}}`: The output of a specific task (uses the custom label you assigned to the task).
- `{{char}}`, `{{user}}`, `{{personality}}`, etc.: All standard SillyTavern macros.
- `{{wi}}` or `{{world_info}}`: Automatically scans chat context and injects relevant Lorebook entries.

## Task Options

| Option | Description |
|--------|-------------|
| **Strip Think** | Removes `<think>...</think>` tags from output before passing to next steps. |
| **Pre-message** | Posts the result to chat as a system note immediately upon task completion. |
| **Character Message** | Posts using the character's name and avatar. |

## Engine Controls

- **Request Delay**: Pause between API calls to avoid rate limits.
- **Max Retries**: Automatically retry failed or empty model responses.
- **Timeout**: Prevents the pipeline from hanging on slow or stuck connections.
