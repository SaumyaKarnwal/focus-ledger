rootProject.name = "focus-ledger"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories { mavenCentral() }
}

include(":backend:core", ":backend:data", ":backend:api-grpc", ":backend:api-mcp", ":backend:app")
