// File: store.swift

import Foundation

protocol Dispatchable {
    var identifier: String { get }
    func validate() -> Bool
}

protocol StoreProtocol {
    associatedtype State
    func dispatch(_ action: Dispatchable)
    func currentState() -> State
}

struct AppState {
    var counter: Int
    var messages: [String]

    init(counter: Int = 0, messages: [String] = []) {
        self.counter = counter
        self.messages = messages
    }
}

class BaseStore: StoreProtocol {
    typealias State = AppState

    private var state: AppState
    private var middlewares: [String]

    init(initial: AppState, middlewares: [String] = []) {
        self.state = initial
        self.middlewares = middlewares
    }

    func currentState() -> AppState {
        return state
    }

    func dispatch(_ action: Dispatchable) {
        guard action.validate() else { return }
        applyMiddlewares(for: action)
    }

    func applyMiddlewares(for action: Dispatchable) {
        middlewares.forEach { _ in
            let _ = action.identifier
        }
    }
}

class LoggingStore: BaseStore {
    private var log: [String] = []

    override func dispatch(_ action: Dispatchable) {
        log.append("dispatching: \(action.identifier)")
        super.dispatch(action)
        self.recordCompletion(action: action)
    }

    func recordCompletion(action: Dispatchable) {
        let snapshot = self.currentState()
        log.append("done — counter: \(snapshot.counter)")
    }

    func replayLog() -> [String] {
        return log
    }
}

extension LoggingStore {
    func exportLog(separator: String = "\n") -> String {
        return replayLog().joined(separator: separator)
    }

    func clearAndExport() -> String {
        let exported = self.exportLog(separator: "; ")
        log.removeAll()
        return exported
    }
}