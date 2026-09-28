val codegen: SourceSet = sourceSets.create("codegen")

dependencies {
    implementation(project(":backend:core"))
    implementation(libs.flyway.core)
    implementation(libs.jooq)
    implementation(libs.hikari)
    runtimeOnly(libs.flyway.database.postgresql)
    runtimeOnly(libs.postgresql)

    "codegenImplementation"(libs.jooq.codegen)
    "codegenImplementation"(libs.flyway.core)
    "codegenImplementation"(libs.testcontainers.postgresql)
    "codegenRuntimeOnly"(libs.flyway.database.postgresql)
    "codegenRuntimeOnly"(libs.postgresql)

    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.postgresql)
}

val dockerPostgresDir = rootProject.file("docker/postgres")
val migrationDir = file("src/main/resources/db/migration")
val jooqOutputDir = layout.buildDirectory.dir("generated/jooq")

val generateJooq =
    tasks.register<JavaExec>("generateJooq") {
        description = "Migrates a Postgres 18 container with V1 and generates the jOOQ classes."
        group = "build"
        classpath = codegen.runtimeClasspath
        mainClass = "io.focusledger.data.codegen.GenerateJooqKt"
        inputs.dir(dockerPostgresDir)
        inputs.dir(migrationDir)
        inputs.files(codegen.output)
        outputs.dir(jooqOutputDir)
        doFirst { delete(jooqOutputDir) }
        argumentProviders.add(
            CommandLineArgumentProvider {
                listOf(dockerPostgresDir.path, migrationDir.path, jooqOutputDir.get().asFile.path)
            }
        )
    }

sourceSets.main { java.srcDir(generateJooq) }

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
