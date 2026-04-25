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

    func withPriority(_ priority: Priority) -> Todo {
        var copy = self
        copy.priority = priority
        return copy
    }
}