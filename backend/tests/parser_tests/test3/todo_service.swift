// File: todo_service.swift

import Foundation

class TodoService {
    private var store: [UUID: Todo] = [:]

    func add(_ todo: Todo) {
        store[todo.id] = todo
    }

    func all() -> [Todo] {
        return store.values.sorted { $0.title < $1.title }
    }

    func complete(id: UUID) -> Todo? {
        guard var todo = store[id] else { return nil }
        todo.isCompleted = true
        store[id] = todo
        return todo
    }

    func highPriority() -> [Todo] {
        return all().filter { $0.priority == .high }
    }

    func bulkAdd(_ todos: [Todo]) {
        todos.forEach { self.add($0) }
    }
}