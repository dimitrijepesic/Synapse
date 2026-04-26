// File: todo_model.swift

import Foundation

enum Priority: String {
    case low, medium, high
}

struct Todo {
    let id: UUID
    var title: String
    var priority: Priority
    var isCompleted: Bool

    init(title: String, priority: Priority = .medium) {
        self.id = UUID()
        self.title = title
        self.priority = priority
        self.isCompleted = false
    }

    mutating func complete() {
        isCompleted = true
    }
}

struct User {
    let id: UUID
    var username: String
    var isAdmin: Bool

    init(username: String, isAdmin: Bool = false) {
        self.id = UUID()
        self.username = username
        self.isAdmin = isAdmin
    }
}
