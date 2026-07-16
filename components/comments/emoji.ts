// Emoji sets for comment reactions — pure constants, safe for client & server

// The five one-click quick reactions on the hover action bar
export const QUICK_REACTIONS = ["👍", "😀", "❤️", "😮", "🎉"] as const

// Curated picker grid ("choose another emoji") — no external picker dependency
export const EMOJI_PICKER: string[] = [
  "👍", "👎", "😀", "😂", "😅", "🙂", "😉", "😍",
  "❤️", "💔", "😮", "😢", "😡", "🤔", "🙏", "👏",
  "🎉", "🔥", "💯", "✅", "❌", "⚠️", "❓", "❗",
  "👀", "💰", "📈", "📉", "📅", "🏠", "🛏️", "🔑",
  "⭐", "🚀", "🐢", "☕", "🍀", "💡", "🧠", "🤝",
]
