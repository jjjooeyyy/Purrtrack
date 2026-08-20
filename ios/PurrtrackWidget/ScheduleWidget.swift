import WidgetKit
import SwiftUI

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let catName: String
    let schedule: [MealItem]
}

struct MealItem: Codable, Hashable {
    let time: String
    let foodName: String
    let grams: Double
    let category: String
    
    enum CodingKeys: String, CodingKey {
        case time, foodName, grams, category
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        time = try container.decode(String.self, forKey: .time)
        foodName = try container.decode(String.self, forKey: .foodName)
        category = try container.decode(String.self, forKey: .category)
        
        // Handle grams as either Int or Double from JSON
        if let doubleGrams = try? container.decode(Double.self, forKey: .grams) {
            grams = doubleGrams
        } else if let intGrams = try? container.decode(Int.self, forKey: .grams) {
            grams = Double(intGrams)
        } else {
            grams = 0
        }
    }
}

struct ScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(date: Date(), catName: "Cat", schedule: [])
    }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> ()) {
        let entry = ScheduleEntry(date: Date(), catName: getCatName(), schedule: getSchedule())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entry = ScheduleEntry(date: Date(), catName: getCatName(), schedule: getSchedule())
        let timeline = Timeline(entries: [entry], policy: .atEnd)
        completion(timeline)
    }

    private func getCatName() -> String {
        let sharedDefaults = UserDefaults(suiteName: "group.com.jjjooeyyy.purrtrack")
        return sharedDefaults?.string(forKey: "activePetName") ?? "Cat"
    }

    private func getSchedule() -> [MealItem] {
        let sharedDefaults = UserDefaults(suiteName: "group.com.jjjooeyyy.purrtrack")
        let jsonString = sharedDefaults?.string(forKey: "todaySchedule")
        print("Widget read json: \(jsonString ?? "nil")")
        
        guard let jsonString = jsonString,
              let data = jsonString.data(using: .utf8) else {
            return []
        }
        do {
            let decoder = JSONDecoder()
            // Important: Handle case-insensitive or optional keys if needed
            return try decoder.decode([MealItem].self, from: data)
        } catch {
            print("Widget decode error: \(error)")
            return []
        }
    }
}

struct ScheduleWidgetView: View {
    var entry: ScheduleEntry
    @Environment(\.widgetRenderingMode) var renderingMode

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(entry.catName)的食物安排")
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .foregroundColor(renderingMode == .fullColor ? Color(red: 0.2, green: 0.2, blue: 0.3) : .primary)
                Spacer()
                Image(systemName: "calendar")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            .padding(.bottom, 2)

            if entry.schedule.isEmpty {
                Spacer()
                Text("今天沒有安排的餐點")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                ForEach(entry.schedule.prefix(3), id: \.self) { item in
                    HStack {
                        Text(item.time)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(renderingMode == .fullColor ? Color.blue.opacity(0.1) : Color.clear)
                            .cornerRadius(4)
                        
                        Text(item.foodName)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .lineLimit(1)
                        
                        Spacer()
                        
                        Text(String(format: "%.0fg", item.grams))
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.secondary)
                    }
                    Divider().opacity(0.5)
                }
                if entry.schedule.count > 3 {
                    Text("+ \(entry.schedule.count - 3) 餐")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(12)
        .widgetURL(URL(string: "purrtrack://schedule"))
        .containerBackground(for: .widget) {
            Color(red: 1.0, green: 1.0, blue: 1.0)
        }
    }
}

struct ScheduleWidget: Widget {
    let kind: String = "ScheduleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            ScheduleWidgetView(entry: entry)
        }
        .configurationDisplayName("Daily Meal Plan")
        .description("View today's scheduled meals for your pet.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
