package io.focusledger.mcp

import io.focusledger.core.NodeId
import io.focusledger.core.ledger.Node

internal sealed interface PathMatch {
    data class Found(val node: Node) : PathMatch

    data class Ambiguous(val nodes: List<Node>) : PathMatch

    /** [suggestions] holds the paths of the nodes with the closest names. */
    data class Missing(val suggestions: List<String>) : PathMatch
}

/**
 * Node paths for agents. A path is node names joined by " / ", for example "Book / Chapter 1". A
 * path can start at any level: "Chapter 1" matches "Book / Chapter 1". Matching ignores case.
 */
internal class NodePaths(private val summary: LedgerSummary) {
    private val pathsById: Map<NodeId, List<String>> =
        summary.tree.nodes.associate { node -> node.id to summary.pathOf(node.id) }

    fun path(nodeId: NodeId): String = pathsById.getValue(nodeId).joinToString(SEPARATOR)

    fun resolve(path: String): PathMatch {
        val wanted = segments(path)
        val matches =
            summary.tree.nodes.filter { node ->
                pathsById.getValue(node.id).map(::normalize).takeLast(wanted.size) == wanted
            }
        return when (matches.size) {
            0 -> PathMatch.Missing(suggestionsFor(wanted.last()))
            1 -> PathMatch.Found(matches.single())
            else -> PathMatch.Ambiguous(matches)
        }
    }

    private fun suggestionsFor(name: String): List<String> =
        summary.tree.nodes
            .map { node -> node to editDistance(name, normalize(node.name)) }
            .filter { (_, distance) -> distance <= maxOf(1, name.length / 3) }
            .sortedBy { (_, distance) -> distance }
            .take(MAX_SUGGESTIONS)
            .map { (node, _) -> path(node.id) }

    companion object {
        const val SEPARATOR = " / "
        private const val MAX_SUGGESTIONS = 3
        private val separatorPattern = Regex("""\s+/\s+""")

        private fun segments(path: String): List<String> =
            path.split(separatorPattern).map(::normalize)

        private fun normalize(name: String): String = name.trim().lowercase()

        /** The Levenshtein distance: the fewest one-character edits that turn [a] into [b]. */
        private fun editDistance(a: String, b: String): Int {
            val firstRow = IntArray(b.length + 1) { it }
            return a.foldIndexed(firstRow) { i, previous, charA ->
                    val row = IntArray(b.length + 1)
                    row[0] = i + 1
                    b.forEachIndexed { j, charB ->
                        val substitution = previous[j] + if (charA == charB) 0 else 1
                        row[j + 1] = minOf(previous[j + 1] + 1, row[j] + 1, substitution)
                    }
                    row
                }
                .last()
        }
    }
}
