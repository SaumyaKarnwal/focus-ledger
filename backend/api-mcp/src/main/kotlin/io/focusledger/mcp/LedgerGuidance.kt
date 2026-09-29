package io.focusledger.mcp

import io.focusledger.mcp.oauth.PRODUCT_NAME

/** A prompt that the agent's user can start, for example as a slash command. */
internal class PromptDefinition(
    val name: String,
    val description: String,
    val arguments: List<PromptArgumentDefinition>,
    val text: (Map<String, String>) -> String,
)

internal class PromptArgumentDefinition(
    val name: String,
    val description: String,
    val required: Boolean,
)

internal const val LOG_SESSION = "log_session"
internal const val PLAN_PROJECT = "plan_project"

// The agent reads the instructions in every session, so they stay short.
internal val serverInstructions: String =
    checkNotNull(PromptDefinition::class.java.getResource("instructions.md")) {
            "instructions.md is missing from the api-mcp resources."
        }
        .readText()
        .replace("%PRODUCT_NAME%", PRODUCT_NAME)
        .trim()

internal val promptDefinitions: List<PromptDefinition> =
    listOf(
        PromptDefinition(
            name = LOG_SESSION,
            description = "Log the work from this conversation to $PRODUCT_NAME.",
            arguments =
                listOf(
                    PromptArgumentDefinition(
                        "notes",
                        "Optional: what you worked on, if the conversation does not show it.",
                        required = false,
                    )
                ),
        ) { arguments ->
            listOfNotNull(
                    "Log the work from this conversation to $PRODUCT_NAME.",
                    "1. Find each block of work in this conversation: what I worked on, when it " +
                        "started, and how long it took. Ask me for a time that you cannot find.",
                    "2. Call list_nodes for this_week in my time zone, and choose a node for each " +
                        "block. Suggest a new child node only when none fits.",
                    "3. Choose the mode for each block: deep_focus, execution, or shallow.",
                    "4. Show me a table with the node path, mode, start, and minutes. Log nothing yet.",
                    "5. After I say yes, call log_cycle once for each row, with a request_id. " +
                        "Then show list_nodes for today.",
                    arguments["notes"]?.takeIf { it.isNotBlank() }?.let { "My notes: $it" },
                )
                .joinToString("\n")
        },
        PromptDefinition(
            name = PLAN_PROJECT,
            description = "Plan the node tree and the estimates for a project.",
            arguments =
                listOf(
                    PromptArgumentDefinition("project", "The project's name.", required = true),
                    PromptArgumentDefinition(
                        "parent_path",
                        "Optional: the path of the node to put the project under.",
                        required = false,
                    ),
                ),
        ) { arguments ->
            val project = arguments["project"].orEmpty()
            val parent =
                arguments["parent_path"]?.takeIf { it.isNotBlank() }?.let { "under \"$it\"" }
                    ?: "at the top level"
            listOf(
                    "Plan the node tree for the project \"$project\" in $PRODUCT_NAME, $parent.",
                    "1. Call list_nodes, and check for nodes that already cover this project.",
                    "2. Propose a tree of at most three levels. Name each task so that I can " +
                        "finish it.",
                    "3. Suggest an estimate for each task: a count of cycles per mode.",
                    "4. Show me the tree and the estimates. Create nothing yet.",
                    "5. After I say yes, call create_node for each new node, parents first, with " +
                        "a request_id. Then call set_estimate for each task.",
                )
                .joinToString("\n")
        },
    )
