// File: auth.swift

import Foundation

class AuthManager {
    private var tokens: [String: User] = [:]

    func issueToken(for user: User) -> String {
        let token = UUID().uuidString
        tokens[token] = user
        return token
    }

    func validate(_ token: String) -> User? {
        return tokens[token]
    }
}
