import { Node, mergeAttributes } from "@tiptap/core"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    loomEmbed: {
      insertLoomEmbed: (options: { loomId: string }) => ReturnType
    }
  }
}

export const LoomEmbed = Node.create({
  name: "loomEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      loomId: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "div[data-loom-id]",
        getAttrs(node) {
          if (typeof node === "string") return false
          return { loomId: (node as HTMLElement).getAttribute("data-loom-id") }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const loomId = HTMLAttributes.loomId
    return [
      "div",
      mergeAttributes(
        {
          "data-loom-id": loomId,
          class: "loom-embed aspect-video rounded-lg overflow-hidden my-4",
        },
      ),
      [
        "iframe",
        {
          src: `https://www.loom.com/embed/${loomId}`,
          frameborder: "0",
          webkitallowfullscreen: "true",
          mozallowfullscreen: "true",
          allowfullscreen: "true",
          class: "w-full h-full",
        },
      ],
    ]
  },

  addCommands() {
    return {
      insertLoomEmbed:
        ({ loomId }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { loomId },
          })
        },
    }
  },
})
