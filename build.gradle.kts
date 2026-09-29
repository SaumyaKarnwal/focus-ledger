import com.diffplug.gradle.spotless.SpotlessExtension
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.spotless)
}

val ktfmtVersion = libs.versions.ktfmt.get()

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
