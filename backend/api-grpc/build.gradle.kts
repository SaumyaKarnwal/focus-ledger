import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

dependencies {
    implementation(project(":backend:core"))

    api(libs.protobuf.java)
    api(libs.protobuf.kotlin)
    api(libs.grpc.protobuf)
    api(libs.grpc.stub)
    api(libs.grpc.kotlin.stub)
    api(libs.armeria.grpc)
    implementation(libs.nimbus.jose.jwt)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(testFixtures(project(":backend:data")))
    testImplementation(project(":backend:data"))
}

val dockerPostgresDir = rootProject.file("docker/postgres")

tasks.test {
    inputs.dir(dockerPostgresDir)
    systemProperty("focusledger.dockerPostgresDir", dockerPostgresDir.path)
}

val bufExecutable: Configuration = configurations.create("bufExecutable")

dependencies { bufExecutable("build.buf:buf:${libs.versions.buf.get()}:${bufPlatform()}@exe") }

val generatedDir = layout.buildDirectory.dir("generated/buf")

val bufGenerate =
    tasks.register<Exec>("bufGenerate") {
        description = "Generates the Kotlin and Java code for proto/ with buf.gen.yaml."
        val repoRoot = rootProject.layout.projectDirectory
        inputs.dir(repoRoot.dir("proto"))
        inputs.files(repoRoot.file("buf.yaml"), repoRoot.file("buf.gen.yaml"), bufExecutable)
        outputs.dir(generatedDir)
        workingDir = repoRoot.asFile
        doFirst {
            val buf = bufExecutable.singleFile
            buf.setExecutable(true)
            executable = buf.path
        }
        args("generate", "--template", "buf.gen.yaml")
    }

val bufLint =
    tasks.register<Exec>("bufLint") {
        description = "Runs buf lint on proto/."
        val repoRoot = rootProject.layout.projectDirectory
        inputs.dir(repoRoot.dir("proto"))
        inputs.files(repoRoot.file("buf.yaml"), bufExecutable)
        workingDir = repoRoot.asFile
        doFirst {
            val buf = bufExecutable.singleFile
            buf.setExecutable(true)
            executable = buf.path
        }
        args("lint")
    }

tasks.named("check") { dependsOn(bufLint) }

sourceSets.main {
    java.srcDir(generatedDir.map { it.dir("java") })
    kotlin.srcDir(generatedDir.map { it.dir("kotlin") })
}

tasks.named<JavaCompile>("compileJava") { dependsOn(bufGenerate) }

tasks.withType<KotlinCompile>().configureEach { dependsOn(bufGenerate) }

fun bufPlatform(): String {
    val osName = System.getProperty("os.name").lowercase()
    val os =
        when {
            osName.startsWith("mac") -> "osx"
            osName.startsWith("linux") -> "linux"
            osName.startsWith("windows") -> "windows"
            else -> error("buf has no binary for the OS $osName")
        }
    val arch =
        when (val osArch = System.getProperty("os.arch")) {
            "aarch64",
            "arm64" -> "aarch_64"
            "amd64",
            "x86_64" -> "x86_64"
            else -> error("buf has no binary for the CPU $osArch")
        }
    return "$os-$arch"
}
