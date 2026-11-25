import Foundation

/// The gate's real `426` body, so tests reject the way the server does.
enum UpgradeRequiredStub {
    static let updateUrl = URL(string: "https://apps.apple.com/app/id123")!

    static let body = #"{"code":"UPGRADE_REQUIRED","message":"This app version is no longer supported. Please update.","updateUrl":"https://apps.apple.com/app/id123"}"#
}
