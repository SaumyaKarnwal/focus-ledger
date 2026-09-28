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
