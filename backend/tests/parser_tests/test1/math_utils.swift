// File: math_utils.swift

import Foundation
import os.signpost

func clamp(_ value: Int, min: Int, max: Int) -> Int {
    if value < min { return min }
    if value > max { return max }
    return value
}

func normalize(values: [Double]) -> [Double] {
    guard let maxVal = values.max(), maxVal != 0 else { return values }
    return values.map { $0 / maxVal }
}

func summarize(label: String, values: [Double]) -> String {
    let normed = normalize(values: values)
    let clamped = normed.map { clamp(Int($0 * 100), min: 0, max: 100) }
    return "\(label): \(clamped)"
}

func loadAndSummarize(path: String, label: String) throws -> String {
    guard !path.isEmpty else {
        throw NSError(domain: "MathUtils", code: 1, userInfo: nil)
    }
    let raw = try String(contentsOfFile: path, encoding: .utf8)
    let values = raw.split(separator: ",").compactMap { Double($0) }
    return summarize(label: label, values: values)
}

func batchSummarize(_ entries: [(path: String, label: String)]) -> [String] {
    return entries.compactMap { entry in
        try? loadAndSummarize(path: entry.path, label: entry.label)
    }
}