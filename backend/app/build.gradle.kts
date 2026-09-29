plugins { application }

dependencies {
    implementation(platform(libs.netty.bom))
    implementation(project(":backend:core"))
    implementation(project(":backend:data"))
    implementation(project(":backend:api-grpc"))
    implementation(project(":backend:api-mcp"))
    implementation(libs.armeria)
    implementation(libs.ktor.server.netty)
    implementation(libs.hikari)
    runtimeOnly(libs.slf4j.simple)

    testImplementation(testFixtures(project(":backend:api-mcp")))
    testImplementation(libs.kotlinx.serialization.json)
}

application { mainClass = "io.focusledger.app.MainKt" }

@Suppress("UNCHECKED_CAST")
val localEnvironment = rootProject.extra["localEnvironment"] as () -> Map<String, String>

tasks.register<JavaExec>("runLocal") {
    description =
        "Starts the local Postgres, applies the migrations, and runs the program with the " +
            "settings in .env. Serves web/dist when it exists."
    group = "application"
    dependsOn(":backend:data:startLocalDatabase", ":backend:data:migrateLocal")
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass = application.mainClass
    doFirst {
        environment(mapOf("WEB_DIR" to rootProject.file("web/dist").path) + localEnvironment())
    }
}
