dependencies {
    implementation(project(":backend:core"))
    implementation(libs.flyway.core)
    runtimeOnly(libs.flyway.database.postgresql)
    runtimeOnly(libs.postgresql)

    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.postgresql)
}

val dockerPostgresDir = rootProject.file("docker/postgres")

tasks.test {
    inputs.dir(dockerPostgresDir)
    systemProperty("focusledger.dockerPostgresDir", dockerPostgresDir.path)
}

tasks.register<JavaExec>("migrateLocal") {
    description =
        "Applies the migrations to the database in DB_URL_MIGRATE, from the environment or .env."
    group = "database"
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass = "io.focusledger.data.LedgerMigrationsKt"
    doFirst {
        val jdbcUrl =
            System.getenv("DB_URL_MIGRATE") ?: localEnvironment().getValue("DB_URL_MIGRATE")
        environment("DB_URL_MIGRATE", jdbcUrl)
    }
}

/**
 * The variables from the repository's .env file, with `${NAME}` references expanded from earlier
 * lines. For each name, a variable set in the process environment wins over the file.
 */
fun localEnvironment(): Map<String, String> {
    val envFile = rootProject.file(".env")
    check(envFile.exists()) { "Copy .env.example to .env first (see CLAUDE.md, Commands)." }
    val reference = Regex("""\$\{(\w+)}""")
    return envFile
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
