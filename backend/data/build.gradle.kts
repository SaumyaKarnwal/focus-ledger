plugins { `java-test-fixtures` }

val codegen: SourceSet = sourceSets.create("codegen")

dependencies {
    implementation(project(":backend:core"))
    implementation(libs.flyway.core)
    implementation(libs.jooq)
    implementation(libs.hikari)
    runtimeOnly(libs.flyway.database.postgresql)
    implementation(libs.postgresql)

    "codegenImplementation"(libs.jooq.codegen)
    "codegenImplementation"(libs.flyway.core)
    "codegenImplementation"(libs.testcontainers.postgresql)
    "codegenRuntimeOnly"(libs.flyway.database.postgresql)
    "codegenRuntimeOnly"(libs.postgresql)

    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.postgresql)

    testFixturesApi(project(":backend:core"))
    testFixturesApi(libs.testcontainers.postgresql)
    testFixturesImplementation(libs.postgresql)
    testFixturesApi(libs.flyway.core)
    testFixturesImplementation(libs.jooq)
    testFixturesImplementation(platform(libs.junit.bom))
    testFixturesImplementation(libs.junit.jupiter)
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

@Suppress("UNCHECKED_CAST")
val localEnvironment = rootProject.extra["localEnvironment"] as () -> Map<String, String>
