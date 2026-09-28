dependencies {}

/** Groups that backend/core may depend on: the Kotlin standard library and its annotations. */
val allowedDependencyGroups = setOf("org.jetbrains.kotlin", "org.jetbrains")

val checkCoreDependencies =
    tasks.register("checkCoreDependencies") {
        description = "Fails when backend/core depends on anything other than Kotlin."
        group = "verification"
        val mainClasspaths =
            listOf("compileClasspath", "runtimeClasspath").map { name ->
                name to
                    configurations.named(name).flatMap {
                        it.incoming.resolutionResult.rootComponent
                    }
            }
        doLast {
            val forbidden = mainClasspaths.flatMap { (configurationName, root) ->
                root
                    .get()
                    .dependencies
                    .asSequence()
                    .filterIsInstance<org.gradle.api.artifacts.result.ResolvedDependencyResult>()
                    .flatMap { allModules(it.selected) }
                    .mapNotNull { it.moduleVersion }
                    .filter { it.group !in allowedDependencyGroups }
                    .map { "$configurationName: ${it.group}:${it.name}:${it.version}" }
                    .toList()
            }
            check(forbidden.isEmpty()) {
                "backend/core must depend only on Kotlin. Found:\n" +
                    forbidden.distinct().joinToString("\n")
            }
        }
    }

tasks.named("check") { dependsOn(checkCoreDependencies) }

/** [component] and every module it depends on, directly or through other modules. */
fun allModules(
    component: org.gradle.api.artifacts.result.ResolvedComponentResult,
    seen: MutableSet<org.gradle.api.artifacts.component.ComponentIdentifier> = mutableSetOf(),
): Sequence<org.gradle.api.artifacts.result.ResolvedComponentResult> =
    if (!seen.add(component.id)) {
        emptySequence()
    } else {
        sequenceOf(component) +
            component.dependencies
                .asSequence()
                .filterIsInstance<org.gradle.api.artifacts.result.ResolvedDependencyResult>()
                .flatMap { allModules(it.selected, seen) }
    }
