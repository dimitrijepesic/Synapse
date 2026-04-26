// File: todo_service.swift

import Foundation

class TodoRepository {
    private var store: [UUID: Todo] = [:]

    func save(_ todo: Todo) {
        store[todo.id] = todo
    }

    func findById(_ id: UUID) -> Todo? {
        return store[id]
    }

    func findAll() -> [Todo] {
        return Array(store.values)
    }
}

class TodoService {
    private let repo: TodoRepository
    private let logger: Logger

    init(repo: TodoRepository, logger: Logger) {
        self.repo = repo
        self.logger = logger
    }

    func create(title: String, priority: Priority) -> Todo {
        let todo = Todo(title: title, priority: priority)
        repo.save(todo)
        logger.info("Created: \(title)")
        return todo
    }

    func complete(id: UUID) -> Todo? {
        guard var todo = repo.findById(id) else { return nil }
        todo.complete()
        repo.save(todo)
        logger.info("Completed: \(todo.title)")
        return todo
    }

    func listAll() -> [Todo] {
        return repo.findAll()
    }
}

class UserService {
    private var users: [UUID: User] = [:]

    func register(username: String, isAdmin: Bool = false) -> User {
        let user = User(username: username, isAdmin: isAdmin)
        users[user.id] = user
        return user
    }

    func findByUsername(_ name: String) -> User? {
        return users.values.first { $0.username == name }
    }
}
