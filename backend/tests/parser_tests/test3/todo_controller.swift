// File: todo_controller.swift

import Foundation

class TodoController {
    private let todoService: TodoService
    private let auth: AuthManager

    init(todoService: TodoService, auth: AuthManager) {
        self.todoService = todoService
        self.auth = auth
    }

    func handleCreate(title: String, priority: Priority, token: String) -> Todo? {
        guard auth.validate(token) != nil else { return nil }
        return todoService.create(title: title, priority: priority)
    }

    func handleComplete(todoId: UUID, token: String) -> Todo? {
        guard auth.validate(token) != nil else { return nil }
        return todoService.complete(id: todoId)
    }

    func handleList(token: String) -> [Todo] {
        guard auth.validate(token) != nil else { return [] }
        return todoService.listAll()
    }
}

class UserController {
    private let userService: UserService
    private let auth: AuthManager

    init(userService: UserService, auth: AuthManager) {
        self.userService = userService
        self.auth = auth
    }

    func handleRegister(username: String) -> User {
        return userService.register(username: username)
    }

    func handleLogin(username: String) -> String? {
        guard let user = userService.findByUsername(username) else { return nil }
        return auth.issueToken(for: user)
    }
}
