import AudioToolbox
import UIKit

/// Haptics + Finny's soft click sounds. Each can be turned off in Settings.
@MainActor
enum Feedback {
    enum Kind { case tap, select, success, warning }

    static var hapticsOn: Bool { UserDefaults.standard.object(forKey: "haptics") as? Bool ?? true }
    static var soundsOn: Bool { UserDefaults.standard.object(forKey: "sounds") as? Bool ?? true }

    private static var sounds: [String: SystemSoundID] = [:]
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let notify = UINotificationFeedbackGenerator()
    private static let selection = UISelectionFeedbackGenerator()

    static func play(_ kind: Kind) {
        if hapticsOn {
            switch kind {
            case .tap: soft.impactOccurred(intensity: 0.7)
            case .select: selection.selectionChanged()
            case .success: notify.notificationOccurred(.success)
            case .warning: notify.notificationOccurred(.warning)
            }
        }
        if soundsOn {
            switch kind {
            case .tap: sound("tap")
            case .select: sound("tick")
            case .success: sound("success")
            case .warning: sound("tap")
            }
        }
    }

    /// System sounds are low-latency and respect the silent switch.
    private static func sound(_ name: String) {
        if sounds[name] == nil, let url = Bundle.main.url(forResource: name, withExtension: "wav") {
            var id: SystemSoundID = 0
            AudioServicesCreateSystemSoundID(url as CFURL, &id)
            sounds[name] = id
        }
        if let id = sounds[name] { AudioServicesPlaySystemSound(id) }
    }
}
