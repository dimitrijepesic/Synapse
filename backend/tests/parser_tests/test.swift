import Foundation
import Hydra

class Store {
    func dispatch() {
        runReducer()
        Logger.log()
    }
    
    func runReducer() {
        let x = 1
    }
}