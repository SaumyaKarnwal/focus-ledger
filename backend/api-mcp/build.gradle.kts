dependencies {
    implementation(project(":backend:core"))
    implementation(libs.mcp.kotlin.sdk.server)
    implementation(libs.ktor.server.netty)

    testImplementation(libs.ktor.server.test.host)
}

val testdataDir = rootProject.file("testdata")

tasks.test {
    inputs.dir(testdataDir)
    systemProperty("focusledger.testdata", testdataDir.path)
}
