// File: todo_controller.swift

import Foundation

class TodoController {
    private let service: TodoService

    init(service: TodoService) {
        self.service = service
    }

    func seedDefaults() {
        let items: [Todo] = [
            Todo(title: "Design state model", priority: .high),
            Todo(title: "Wire up reducers", priority: .medium),
            Todo(title: "Write tests", priority: .low),
        ]
        service.bulkAdd(items)
    }

    func promoteAll() {
        let promoted = service.all().map { $0.withPriority(.high) }
        service.bulkAdd(promoted)
    }

    func completeHighPriority() -> [Todo] {
        let targets = service.highPriority()
        return targets.compactMap { service.complete(id: $0.id) }
    }

    func report() -> String {
        let all = service.all()
        let done = all.filter { $0.isCompleted }
        return "total: \(all.count), done: \(done.count)"
    }
}