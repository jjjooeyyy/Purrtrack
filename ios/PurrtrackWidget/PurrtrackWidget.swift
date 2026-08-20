import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), catName: "Cat")
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let entry = SimpleEntry(date: Date(), catName: getCatName())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entries = [SimpleEntry(date: Date(), catName: getCatName())]
        let timeline = Timeline(entries: entries, policy: .atEnd)
        completion(timeline)
    }

    private func getCatName() -> String {
        let sharedDefaults = UserDefaults(suiteName: "group.com.jjjooeyyy.purrtrack")
        return sharedDefaults?.string(forKey: "activePetName") ?? "Cat"
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let catName: String
}

struct PurrtrackWidgetEntryView : View {
    var entry: Provider.Entry
    @Environment(\.widgetRenderingMode) var renderingMode

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "pawprint.fill")
                    .foregroundColor(renderingMode == .fullColor ? Color(red: 1.0, green: 0.6, blue: 0.2) : .primary)
                Text(entry.catName)
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .foregroundColor(renderingMode == .fullColor ? Color(red: 0.2, green: 0.2, blue: 0.3) : .primary)
            }
            
            HStack(spacing: 10) {
                WidgetButton(label: "🍴", action: "meal", color: Color(red: 0.4, green: 0.7, blue: 1.0))
                WidgetButton(label: "💧", action: "water", color: Color(red: 0.4, green: 0.8, blue: 0.8))
                WidgetButton(label: "🚽", action: "litter", color: Color(red: 0.9, green: 0.6, blue: 0.8))
            }
        }
        .containerBackground(for: .widget) {
            if renderingMode == .fullColor {
                ZStack {
                    Color(red: 0.98, green: 0.97, blue: 0.94)
                    Circle()
                        .fill(Color(red: 1.0, green: 0.9, blue: 0.0, opacity: 0.1))
                        .frame(width: 200, height: 200)
                        .offset(x: 50, y: -50)
                }
            } else {
                // Background for tinted mode (usually ignored by system, but good practice)
                Color.clear
            }
        }
    }
}

struct WidgetButton: View {
    let label: String
    let action: String
    let color: Color
    @Environment(\.widgetRenderingMode) var renderingMode
    
    var body: some View {
        let isTinted = renderingMode != .fullColor
        
        Link(destination: URL(string: "purrtrack://log/\(action)")!) {
            VStack(spacing: 4) {
                Text(label)
                    .font(.system(size: 20))
                Text(action == "litter" ? "Wee" : action.capitalized)
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundColor(isTinted ? .primary : .white)
            }
            .frame(width: 44, height: 54)
            .background(isTinted ? Color.clear : color)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isTinted ? Color.primary.opacity(0.5) : Color.clear, lineWidth: 1)
            )
            .shadow(color: isTinted ? .clear : color.opacity(0.3), radius: 2, x: 0, y: 2)
            .widgetAccentable(true)
        }
    }
}

struct PurrtrackWidget: Widget {
    let kind: String = "PurrtrackWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            PurrtrackWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Purrtrack Quick Log")
        .supportedFamilies([.systemSmall])
    }
}