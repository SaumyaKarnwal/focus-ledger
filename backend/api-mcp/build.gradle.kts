plugins { `java-test-fixtures` }

dependencies {
    implementation(project(":backend:core"))
    implementation(libs.mcp.kotlin.sdk.server)
    implementation(libs.ktor.server.netty)
    implementation(libs.nimbus.jose.jwt)
    implementation(libs.okhttp)

    testFixturesApi(project(":backend:core"))

    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.okhttp.tls)
}

val testdataDir = rootProject.file("testdata")

tasks.test {
    inputs.dir(testdataDir)
    systemProperty("focusledger.testdata", testdataDir.path)
}
