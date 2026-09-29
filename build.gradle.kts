import com.diffplug.gradle.spotless.SpotlessExtension
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.spotless)
}

val ktfmtVersion = libs.versions.ktfmt.get()

/**
 * The variables from the repository's .env file, with `${NAME}` references expanded from earlier
 * lines. For each name, a variable set in the process environment wins over the file. Module build
 * files read it as `rootProject.extra["localEnvironment"]`.
 */
val localEnvironment: () -> Map<String, String> = {
    val envFile = rootProject.file(".env")
    check(envFile.exists()) { "Copy .env.example to .env first (see CLAUDE.md, Commands)." }
    val reference = Regex("""\$\{(\w+)}""")
    envFile
        .readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .fold(mapOf()) { resolved, line ->
            val name = line.substringBefore("=").trim()
            val rawValue = System.getenv(name) ?: line.substringAfter("=").trim()
            val value =
                reference.replace(rawValue) { match ->
                    val referenced = match.groupValues[1]
                    System.getenv(referenced)
                        ?: resolved[referenced]
                        ?: error("$name uses \${$referenced}, which .env does not set.")
                }
            resolved + (name to value)
        }
}

extra["localEnvironment"] = localEnvironment

spotless {
    kotlinGradle {
        target("*.gradle.kts")
        ktfmt(ktfmtVersion).kotlinlangStyle()
    }
}

subprojects {
    if (childProjects.isNotEmpty()) return@subprojects
    check(buildFile.exists()) { "Module $path has no build file: $buildFile" }

    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "com.diffplug.spotless")

    extensions.configure<KotlinJvmProjectExtension> { jvmToolchain(21) }

    extensions.configure<SpotlessExtension> {
        kotlin {
            targetExclude("build/**")
            ktfmt(ktfmtVersion).kotlinlangStyle()
        }
        kotlinGradle { ktfmt(ktfmtVersion).kotlinlangStyle() }
    }

    dependencies {
        "testImplementation"(platform(rootProject.libs.junit.bom))
        "testImplementation"(rootProject.libs.junit.jupiter)
        "testRuntimeOnly"(rootProject.libs.junit.platform.launcher)
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        systemProperty("user.timezone", "UTC")
    }
}

tasks.register<Exec>("deploy") {
    description =
        "Deploys origin/main to Cloud Run and keeps the two newest images. Ask the owner first."
    group = "deployment"
    dependsOn(":backend:app:installDist")
    commandLine("infra/deploy.sh")
}
