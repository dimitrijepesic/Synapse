// File: main.swift

import Foundation

class Application {
    let logger: Logger
    let auth: AuthManager
    let userService: UserService
    let todoService: TodoService
    let todoController: TodoController
    let userController: UserController

    init() {
        logger = Logger()
        auth = AuthManager()
        userService = UserService()
        let repo = TodoRepository()
        todoService = TodoService(repo: repo, logger: logger)
        todoController = TodoController(todoService: todoService, auth: auth)
        userController = UserController(userService: userService, auth: auth)
    }

    func run() {
        let admin = userController.handleRegister(username: "admin")
        guard let token = userController.handleLogin(username: "admin") else { return }

        let _ = todoController.handleCreate(title: "Design model", priority: .high, token: token)
        let _ = todoController.handleCreate(title: "Write tests", priority: .medium, token: token)

        let todos = todoController.handleList(token: token)
        for todo in todos {
            let _ = todoController.handleComplete(todoId: todo.id, token: token)
        }

        logger.info("Done. \(todos.count) todos processed.")
    }
}

let app = Application()
app.run()
