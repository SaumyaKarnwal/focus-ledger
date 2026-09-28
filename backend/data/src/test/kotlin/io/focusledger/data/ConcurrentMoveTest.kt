package io.focusledger.data

import io.focusledger.data.TestDatabase.APP
import io.focusledger.data.TestDatabase.CHECK_VIOLATION
import io.focusledger.data.TestDatabase.SUPERUSER
import io.focusledger.data.TestDatabase.connectAs
import java.sql.Connection
import java.sql.SQLException
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.RepeatedTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow

class ConcurrentMoveTest {

    /**
     * Transaction 1 moves A under B and holds its transaction open. Transaction 2 then moves B
     * under A. Without a per-user lock, each trigger sees only committed rows, finds no loop, and
     * both moves commit.
     */
    @RepeatedTest(3)
    fun crossedMoves_inParallel_exactlyOneSucceeds() {
        val (userId, nodeA, nodeB) =
            connectAs(APP).use { setup ->
                val fixtures = LedgerFixtures(setup)
                val userId = fixtures.newUser()
                Triple(userId, fixtures.newNode(userId), fixtures.newNode(userId))
            }

        connectAs(APP).use { first ->
            connectAs(APP).use { second ->
                first.autoCommit = false
                second.autoCommit = false
                val secondPid = second.queryString("SELECT pg_backend_pid()")!!.toInt()

                val firstResult = runCatching { first.move(userId, nodeA, under = nodeB) }
                val secondMove = CompletableFuture.supplyAsync {
                    runCatching {
                        second.move(userId, nodeB, under = nodeA)
                        second.commit()
                    }
                }
                awaitBlockedOrDone(secondPid, secondMove)
                first.commit()
                val secondResult = secondMove.get(10, TimeUnit.SECONDS)
                if (secondResult.isFailure) second.rollback()

                assertEquals(
                    listOf(true, false),
                    listOf(firstResult, secondResult).map { it.isSuccess },
                )
                assertEquals(
                    CHECK_VIOLATION,
                    (secondResult.exceptionOrNull() as? SQLException)?.sqlState,
                )
            }
        }
        assertEquals(1, rootCount(userId, nodeA, nodeB))
    }

    /** A loop can only come from a bug or a manual fix. The loop check must still end. */
    @Test
    fun moveIntoExistingLoop_ancestorQueryEnds() {
        val (userId, nodeA, nodeB) =
            connectAs(APP).use { setup ->
                val fixtures = LedgerFixtures(setup)
                val userId = fixtures.newUser()
                Triple(userId, fixtures.newNode(userId), fixtures.newNode(userId))
            }
        connectAs(SUPERUSER).use { superuser ->
            superuser.execute("SET session_replication_role = replica")
            superuser.move(userId, nodeA, under = nodeB)
            superuser.move(userId, nodeB, under = nodeA)
        }
        val nodeC = connectAs(APP).use { LedgerFixtures(it).newNode(userId) }

        connectAs(APP).use { app ->
            app.execute("SET statement_timeout = '5s'")
            assertDoesNotThrow { app.move(userId, nodeC, under = nodeA) }
        }
    }

    private fun Connection.move(userId: UUID, nodeId: UUID, under: UUID) =
        execute(
            "UPDATE ledger.node SET parent_id = ? WHERE user_id = ? AND id = ?",
            under,
            userId,
            nodeId,
        )

    /** Waits until [pid] waits on a lock, or [move] ends, so that the test does not race itself. */
    private fun awaitBlockedOrDone(pid: Int, move: CompletableFuture<*>) {
        connectAs(SUPERUSER).use { observer ->
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (!move.isDone && System.nanoTime() < deadline) {
                val waiting =
                    observer.queryString(
                        "SELECT count(*) FROM pg_locks WHERE pid = ? AND NOT granted",
                        pid,
                    )
                if (waiting != "0") return
                Thread.sleep(20)
            }
        }
    }

    private fun rootCount(userId: UUID, vararg nodeIds: UUID): Int =
        connectAs(APP).use { app ->
            nodeIds.count { nodeId ->
                app.queryString(
                    "SELECT parent_id FROM ledger.node WHERE user_id = ? AND id = ?",
                    userId,
                    nodeId,
                ) == null
            }
        }
}
