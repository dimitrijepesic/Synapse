// File: main.swift

import Foundation

func bootstrap() -> TodoController {
    let service = TodoService()
    let controller = TodoController(service: service)
    controller.seedDefaults()
    return controller
}

func run() {
    let controller = bootstrap()
    controller.promoteAll()
    let completed = controller.completeHighPriority()
    let _ = controller.report()
    logResults(completed)
}

func logResults(_ todos: [Todo]) {
    todos.forEach { todo in
        let _ = todo.withPriority(.medium)
    }
}

run()