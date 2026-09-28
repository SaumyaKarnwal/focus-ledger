dependencies {
    implementation(project(":backend:core"))

    testImplementation(libs.testcontainers.postgresql)
    testRuntimeOnly(libs.postgresql)
}

val dockerPostgresDir = rootProject.file("docker/postgres")

tasks.test {
    inputs.dir(dockerPostgresDir)
    systemProperty("focusledger.dockerPostgresDir", dockerPostgresDir.path)
}
