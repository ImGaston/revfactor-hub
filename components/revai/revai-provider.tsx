"use client"

import { Chat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import type { RevAiMessageMetadata, RevAiTierChoice } from "@/lib/revai/models"

export type RevAiUIMessage = UIMessage<RevAiMessageMetadata>

export type RevAiConversation = {
  id: string
  title: string
  updatedAt: string
  messages: RevAiUIMessage[]
}

type RevAiContextValue = {
  chat: Chat<RevAiUIMessage>
  conversations: RevAiConversation[]
  activeId: string
  tier: RevAiTierChoice
  setTier: (tier: RevAiTierChoice) => void
  newConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  bubbleOpen: boolean
  setBubbleOpen: (open: boolean) => void
}

const RevAiContext = createContext<RevAiContextValue | null>(null)

const MAX_CONVERSATIONS = 30

// Conversations live in this browser only (per user). RevAI is read-only, so
// nothing here is a record of an action; gateway usage is tagged server-side.
function storageKey(userId: string) {
  return `revai:v1:${userId}`
}

function loadConversations(userId: string): RevAiConversation[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    const parsed = raw ? (JSON.parse(raw) as RevAiConversation[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveConversations(userId: string, conversations: RevAiConversation[]) {
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS))
    )
  } catch {
    // Storage full or blocked: the chat still works for this session.
  }
}

function titleFor(messages: RevAiUIMessage[]): string {
  const first = messages.find((message) => message.role === "user")
  const text =
    first?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim() ?? ""
  return text ? (text.length > 60 ? `${text.slice(0, 57)}…` : text) : "New chat"
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type ConversationStore = {
  subscribe: (listener: () => void) => () => void
  get: () => RevAiConversation[]
  set: (next: RevAiConversation[]) => void
}

const NO_CONVERSATIONS: RevAiConversation[] = []

function createConversationStore(userId: string): ConversationStore {
  let cache: RevAiConversation[] | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get() {
      if (cache === null) cache = loadConversations(userId)
      return cache
    },
    set(next) {
      cache = next.slice(0, MAX_CONVERSATIONS)
      saveConversations(userId, cache)
      listeners.forEach((listener) => listener())
    },
  }
}

function createChat(store: ConversationStore, id: string, messages: RevAiUIMessage[]) {
  return new Chat<RevAiUIMessage>({
    id,
    messages,
    transport: new DefaultChatTransport({ api: "/api/revai/chat" }),
    // Persist each settled turn (including stopped or failed ones) so the
    // bubble and the full-screen tab share history across page loads.
    onFinish: ({ messages: settled }) => {
      if (settled.length === 0) return
      const entry: RevAiConversation = {
        id,
        title: titleFor(settled),
        updatedAt: new Date().toISOString(),
        messages: settled,
      }
      store.set([entry, ...store.get().filter((conversation) => conversation.id !== id)])
    },
  })
}

export function RevAiProvider({
  userId,
  children,
}: {
  userId: string
  children: React.ReactNode
}) {
  const [store] = useState(() => createConversationStore(userId))
  const conversations = useSyncExternalStore(store.subscribe, store.get, () => NO_CONVERSATIONS)
  const [chat, setChat] = useState(() => createChat(store, newId(), []))
  const [tier, setTier] = useState<RevAiTierChoice>("auto")
  const [bubbleOpen, setBubbleOpen] = useState(false)

  const newConversation = useCallback(() => {
    chat.stop()
    setChat(createChat(store, newId(), []))
  }, [chat, store])

  const selectConversation = useCallback(
    (id: string) => {
      if (id === chat.id) return
      const conversation = store.get().find((candidate) => candidate.id === id)
      if (!conversation) return
      chat.stop()
      setChat(createChat(store, conversation.id, conversation.messages))
    },
    [chat, store]
  )

  const deleteConversation = useCallback(
    (id: string) => {
      store.set(store.get().filter((conversation) => conversation.id !== id))
      if (id === chat.id) {
        chat.stop()
        setChat(createChat(store, newId(), []))
      }
    },
    [chat, store]
  )

  const value = useMemo<RevAiContextValue>(
    () => ({
      chat,
      conversations,
      activeId: chat.id,
      tier,
      setTier,
      newConversation,
      selectConversation,
      deleteConversation,
      bubbleOpen,
      setBubbleOpen,
    }),
    [chat, conversations, tier, newConversation, selectConversation, deleteConversation, bubbleOpen]
  )

  return <RevAiContext.Provider value={value}>{children}</RevAiContext.Provider>
}

export function useRevAi() {
  const context = useContext(RevAiContext)
  if (!context) throw new Error("useRevAi must be used inside RevAiProvider")
  return context
}

/** Null outside the provider (users without RevAI access). */
export function useOptionalRevAi() {
  return useContext(RevAiContext)
}
